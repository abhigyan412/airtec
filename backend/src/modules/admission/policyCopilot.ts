import Anthropic from '@anthropic-ai/sdk'
import { POLICY_SIMULATORS } from './policySimulators'

/**
 * Admission policy copilot — a natural-language front end over the
 * registered simulators in policySimulators.ts. The model's only
 * capability is calling one or more of those tools and narrating their real
 * output; it has no other tools and no other source of truth about this
 * school. Adding a setting means adding an entry to POLICY_SIMULATORS —
 * nothing here needs to change, since the tool list, the system prompt's
 * capability list, and the dispatch logic are all generated from that
 * registry.
 *
 * schoolId is never part of any tool's JSON schema — there is nothing for a
 * prompt injection to override. It is always injected here from the
 * caller's own req.user!.school_id, never from the model's tool-call input.
 *
 * The loop allows up to MAX_TOOL_TURNS rounds of tool calls (not just one) —
 * this is what lets "what's a good hold-days value?" try a few numbers and
 * compare them before answering, instead of only ever answering the exact
 * hypothetical the question named. Each round may contain multiple parallel
 * tool_use blocks (the Anthropic API's normal parallel-tool-use behavior —
 * nothing here disables it), all executed and returned together. Once the
 * model stops requesting tools, or the turn cap is hit, one final call with
 * no `tools` field forces a wrap-up answer — the model cannot ask for
 * another tool call once `tools` is omitted.
 */

const MAX_TOOL_TURNS = 5

export function isPolicyCopilotAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

export function getPolicyCopilotCapabilities() {
  return POLICY_SIMULATORS.map(p => ({
    name: p.name,
    description: p.description,
    example_prompt: p.examplePrompt,
  }))
}

export interface PolicyCopilotAnswer {
  answer: string
  /** Every tool call that actually ran while producing this answer, in order — may be empty (prose-only: out-of-scope / clarification), may repeat the same tool with different hypothetical values (recommendation-style questions), or mix tools. */
  simulations: { tool_used: string; simulation: unknown }[]
}

const MODEL = 'claude-opus-5'
const DECLINE_ANSWER = "I wasn't able to answer that — please rephrase your question."

function buildSystemPrompt(): string {
  const capabilities = POLICY_SIMULATORS.map(p => `- ${p.name}: ${p.description}`).join('\n')
  return `You help a school administrator reason about their admission policy settings.

Your ONLY capabilities are the tools listed below. You have no other tools and no other knowledge of this school's data.

${capabilities}

Rules:
- Never state a number that did not come from a tool's real output. If you have not called a tool, do not guess or estimate any figure.
- If the question is about one of the capabilities above but is missing a required value (e.g. a hypothetical day count or percentage), ask the user to give it rather than assuming a number.
- For a "what's a good value for X" style question, you may call the relevant tool more than once with a few different hypothetical values to compare outcomes before answering — but don't call excessively or repeat an identical call.
- When summarizing follow-up notes, only describe patterns actually present in the returned data. Many inquiries have no notes recorded at all — say so plainly rather than inventing a plausible-sounding reason when the data is sparse or missing.
- If the question is not about any of the capabilities above (any other setting, other students, unrelated ERP data, or general chit-chat), say plainly that this is outside what you can help with. Do not attempt to answer from general knowledge.
- Keep answers concise and cite the concrete figures from the tool results.`
}

function firstTextBlock(content: Anthropic.ContentBlock[]): string {
  const block = content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  return block?.text ?? DECLINE_ANSWER
}

export async function askPolicyCopilot(question: string, schoolId: string): Promise<PolicyCopilotAnswer> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 30_000 })
  const systemPrompt = buildSystemPrompt()
  const tools: Anthropic.Tool[] = POLICY_SIMULATORS.map(p => ({
    name: p.name,
    description: p.description,
    input_schema: p.inputSchema,
  }))

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }]
  const simulations: PolicyCopilotAnswer['simulations'] = []

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      output_config: { effort: 'low' },
      system: systemPrompt,
      tools,
      messages,
    })

    if (response.stop_reason === 'refusal') {
      console.error('[policy-copilot] refusal:', response.stop_details)
      return { answer: DECLINE_ANSWER, simulations }
    }
    if (response.stop_reason === 'max_tokens') {
      console.error('[policy-copilot] hit max_tokens on turn', turn)
      return { answer: DECLINE_ANSWER, simulations }
    }
    if (response.stop_reason !== 'tool_use') {
      // No (more) tool calls — an out-of-scope refusal in the model's own
      // words, a request for a missing value, or the final answer after
      // earlier tool calls. Either way this IS the answer.
      return { answer: firstTextBlock(response.content), simulations }
    }

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (toolUses.length === 0) {
      return { answer: firstTextBlock(response.content), simulations }
    }

    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = []
    for (const toolUse of toolUses) {
      const plugin = POLICY_SIMULATORS.find(p => p.name === toolUse.name)
      let content: string
      let isError = false

      if (!plugin) {
        // Should be unreachable — the model can only request tools we
        // offered — but never silently ignore an unexpected tool name.
        isError = true
        content = `Unknown tool: ${toolUse.name}`
      } else {
        const parsed = plugin.zodSchema.safeParse(toolUse.input)
        if (!parsed.success) {
          isError = true
          content = `Invalid tool input: ${parsed.error.message}`
        } else {
          try {
            const result = await plugin.run(schoolId, parsed.data)
            content = JSON.stringify(result)
            simulations.push({ tool_used: plugin.name, simulation: result })
          } catch (err: any) {
            isError = true
            content = `The simulation could not be run: ${err?.message ?? 'unknown error'}`
          }
        }
      }

      toolResultBlocks.push({ type: 'tool_result', tool_use_id: toolUse.id, content, is_error: isError })
    }

    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResultBlocks })
  }

  // Turn cap reached and the model still wants more — force a final answer
  // with no `tools` field at all, so it structurally cannot ask for another.
  const final = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    output_config: { effort: 'low' },
    system: systemPrompt,
    messages,
  })

  if (final.stop_reason === 'refusal') {
    console.error('[policy-copilot] refusal on final turn:', final.stop_details)
    return { answer: DECLINE_ANSWER, simulations }
  }

  return { answer: firstTextBlock(final.content), simulations }
}
