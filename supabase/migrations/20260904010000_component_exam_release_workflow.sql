-- Per-component-exam release, inside a composite Term cycle.
--
-- A real school almost always reports the composite Term as the official
-- result, so an individual member exam (a Unit Test feeding a Half Yearly,
-- say) rarely if ever gets its own full Freeze->Verify->Publish run — but
-- its own scores are real and final well before the Term's blended result
-- is ready. Without a lighter release point of its own, a component exam
-- sits invisible to students/parents for the entire cycle (both
-- GET /:id/scoresheet and GET /students/:id/performance require
-- exams.status = 'result_published', which a component exam essentially
-- never reaches on its own).
--
-- component_workflow_id lets a school optionally configure a real
-- multi-step approval chain for component exams, same shape as the
-- existing school-wide Result Freeze & Publish Workflow (Result Settings)
-- but attached per Term Template and using entity_type = 'exam_component'
-- so its workflow_instances never collide with the original 'exam'-typed
-- ones (workflow_instances is looked up by (entity_type, entity_id) only,
-- never by workflow_id — two different-but-same-entity_type definitions
-- would silently shadow each other). Null means "no configured workflow" —
-- the fallback is a single Freeze action (see POST /:id/component-freeze).
alter table public.term_templates
  add column component_workflow_id uuid references public.workflow_definitions(id);

-- Traces a Term back to the template it was created from, so a member
-- exam's release-workflow lookup (exam -> result_group_exams ->
-- result_groups -> term_templates.component_workflow_id) is possible at
-- all. Nothing today records this; a Term created by hand (not via
-- "Use This Template") simply has no template and always falls back to
-- the simple per-exam Freeze.
alter table public.result_groups
  add column term_template_id uuid references public.term_templates(id);
