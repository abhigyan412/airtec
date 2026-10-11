import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { simulateFeeHoldPolicy } from '../../shared/utils/admissionFeeHoldSimulator'
import { simulateStageAgingAlert, simulateOccupancyAlert } from '../../shared/utils/admissionAlertSimulator'
import { getStuckInquiryDetails } from '../../shared/utils/admissionInquiryNotes'

/**
 * Registry of every deterministic "what if" simulator the policy copilot can
 * call. Adding a setting means writing its util function (elsewhere) and one
 * entry here — nothing in policyCopilot.ts or routes.ts needs to change.
 *
 * schoolId is deliberately NOT part of any plugin's inputSchema/zodSchema —
 * it's always supplied by the caller (the authenticated request), never by
 * the model. This is what makes cross-tenant leakage via prompt injection
 * structurally impossible, not just policy.
 */
export interface PolicySimulatorPlugin<TParams = any, TResult = any> {
  name: string
  description: string
  inputSchema: Anthropic.Tool['input_schema']
  zodSchema: z.ZodType<TParams>
  examplePrompt: string
  run: (schoolId: string, params: TParams) => Promise<TResult>
}

const FeeHoldInputSchema = z.object({
  hypothetical_hold_days: z.number().int().min(0),
  hypothetical_grace_days: z.number().int().min(0).optional(),
  class_id: z.string().uuid().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
})

const StageAgingInputSchema = z.object({
  hypothetical_aging_days: z.number().int().min(0),
})

const OccupancyInputSchema = z.object({
  hypothetical_percent: z.number().int().min(0).max(100),
  hypothetical_days: z.number().int().min(0).optional(),
})

const StuckInquiryDetailsInputSchema = z.object({
  hypothetical_aging_days: z.number().int().min(0).optional(),
})

export const POLICY_SIMULATORS: PolicySimulatorPlugin[] = [
  {
    name: 'simulate_fee_hold_policy',
    description:
      "Backtests a hypothetical admission fee-hold window against this school's real historical applications and returns which applications would have been saved from auto-rejection or newly rejected, plus the revenue impact. Call this whenever the user asks a \"what if\" question about the fee-hold hold-days or grace-days.",
    inputSchema: {
      type: 'object',
      properties: {
        hypothetical_hold_days: { type: 'integer', minimum: 0, description: 'The hypothetical admission_fee_hold_days value to test.' },
        hypothetical_grace_days: { type: 'integer', minimum: 0, description: "Optional. Defaults to the school's current grace-days setting if omitted." },
        class_id: { type: 'string', description: 'Optional class UUID to filter to a single class. Only include this if the user gave a literal class UUID — there is no name-lookup tool, so never invent one.' },
        from_date: { type: 'string', description: 'Optional ISO date lower bound.' },
        to_date: { type: 'string', description: 'Optional ISO date upper bound.' },
      },
      required: ['hypothetical_hold_days'],
      additionalProperties: false,
    },
    zodSchema: FeeHoldInputSchema,
    examplePrompt: 'What if the fee hold was 10 days?',
    run: (schoolId, params: z.infer<typeof FeeHoldInputSchema>) =>
      simulateFeeHoldPolicy({
        schoolId,
        hypotheticalHoldDays: params.hypothetical_hold_days,
        hypotheticalGraceDays: params.hypothetical_grace_days,
        classId: params.class_id,
        fromDate: params.from_date,
        toDate: params.to_date,
      }),
  },
  {
    name: 'simulate_stage_aging_alert',
    description:
      'Reports how many admission inquiries would be flagged as "stuck too long" on the dashboard under a hypothetical stage-aging threshold (in days), broken down by their current status. Call this whenever the user asks a "what if" question about the stage-aging alert threshold.',
    inputSchema: {
      type: 'object',
      properties: {
        hypothetical_aging_days: { type: 'integer', minimum: 0, description: 'The hypothetical admission_stage_aging_days value to test.' },
      },
      required: ['hypothetical_aging_days'],
      additionalProperties: false,
    },
    zodSchema: StageAgingInputSchema,
    examplePrompt: 'What if the stale-inquiry alert threshold was 5 days?',
    run: (schoolId, params: z.infer<typeof StageAgingInputSchema>) =>
      simulateStageAgingAlert({ schoolId, hypotheticalAgingDays: params.hypothetical_aging_days }),
  },
  {
    name: 'simulate_occupancy_alert',
    description:
      "Reports which classes would be flagged as under-filled on the dashboard under a hypothetical occupancy-warning percent (and optionally a hypothetical days-before-cycle-close window), based on this school's real current seat ledger and admission cycle. Call this whenever the user asks a \"what if\" question about the occupancy warning threshold.",
    inputSchema: {
      type: 'object',
      properties: {
        hypothetical_percent: { type: 'integer', minimum: 0, maximum: 100, description: 'The hypothetical admission_occupancy_warning_percent value to test.' },
        hypothetical_days: { type: 'integer', minimum: 0, description: "Optional. Defaults to the school's current admission_occupancy_warning_days setting if omitted." },
      },
      required: ['hypothetical_percent'],
      additionalProperties: false,
    },
    zodSchema: OccupancyInputSchema,
    examplePrompt: 'What if the occupancy warning was 90%?',
    run: (schoolId, params: z.infer<typeof OccupancyInputSchema>) =>
      simulateOccupancyAlert({ schoolId, hypotheticalPercent: params.hypothetical_percent, hypotheticalDays: params.hypothetical_days }),
  },
  {
    name: 'get_stuck_inquiry_details',
    description:
      'Returns the real names, statuses, and counselor follow-up notes/call outcomes for inquiries currently flagged as stuck past a stage-aging threshold (defaults to the school\'s current setting if no hypothetical value is given). Use this to explain WHY inquiries are stuck, not just how many — call it whenever the user asks why leads are stuck, what the follow-up notes say, or wants a qualitative explanation alongside a stage-aging count. Many inquiries have no follow-up notes recorded at all — only summarize what the notes actually say, and say plainly when they are sparse or missing rather than guessing a reason. Results are capped to a sample of the oldest-stuck inquiries (the response reports the true total separately), not necessarily all of them.',
    inputSchema: {
      type: 'object',
      properties: {
        hypothetical_aging_days: { type: 'integer', minimum: 0, description: "Optional. Defaults to the school's current admission_stage_aging_days setting if omitted." },
      },
      required: [],
      additionalProperties: false,
    },
    zodSchema: StuckInquiryDetailsInputSchema,
    examplePrompt: 'Why are my stale inquiries stuck?',
    run: (schoolId, params: z.infer<typeof StuckInquiryDetailsInputSchema>) =>
      getStuckInquiryDetails({ schoolId, hypotheticalAgingDays: params.hypothetical_aging_days }),
  },
]
