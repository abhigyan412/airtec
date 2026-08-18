-- ═══════════════════════════════════════════════════════════════
-- Timetable module — core schema
-- ═══════════════════════════════════════════════════════════════
--
-- Until now the whole feature was one flat table (timetable_periods:
-- day, period, subject_name TEXT, teacher_id) with no notion of who
-- CAN teach what, how much anyone is allowed to teach, what a school
-- day actually looks like, or what happens when a teacher doesn't turn
-- up. Everything below is the structure the generation engine and the
-- daily arrangement workflow need in order to exist at all.
--
-- RLS is intentionally left OFF, matching this schema's established
-- convention: authorization is enforced at the Express layer (every
-- route scopes by req.user.school_id), not via Postgres RLS. See the
-- header of 20260724000000_notifications.sql for the reasoning.
--
-- day_of_week is 1=Monday .. 6=Saturday throughout, matching the
-- existing timetable_periods CHECK constraint. Sunday is not a school
-- day in this schema and has no representation.

-- ═══════════════════════════════════════════════════════════════
-- 1. ROOMS
-- ═══════════════════════════════════════════════════════════════
-- Most Indian primary/middle schools are homeroom-based: the teacher
-- moves, the students stay. Rooms therefore only matter for the shared
-- spaces that genuinely clash — the computer lab, the science lab, the
-- ground. capacity_groups is how many separate groups the space can
-- host at once (a big ground might take two); everything else is 1.

CREATE TABLE public.classrooms (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    name text NOT NULL,
    room_type text NOT NULL DEFAULT 'classroom',
    capacity integer,
    capacity_groups integer NOT NULL DEFAULT 1,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classrooms_room_type_check CHECK (room_type = ANY (ARRAY[
        'classroom','science_lab','computer_lab','library','ground',
        'music_room','art_room','av_room','auditorium'
    ]::text[])),
    CONSTRAINT classrooms_capacity_groups_check CHECK (capacity_groups >= 1)
);
CREATE UNIQUE INDEX idx_classrooms_school_name ON public.classrooms (school_id, lower(name));
CREATE INDEX idx_classrooms_school_type ON public.classrooms (school_id, room_type) WHERE is_active;

-- ═══════════════════════════════════════════════════════════════
-- 2. DAY TEMPLATES — what a school day is shaped like
-- ═══════════════════════════════════════════════════════════════
-- A school does not have one day shape. Junior classes commonly run
-- fewer periods than senior ones and go home earlier; Saturday is often
-- shorter; exam and activity days replace the grid entirely. Each
-- template owns an ordered list of slots, only some of which are
-- teaching periods — assembly and breaks occupy real time and must be
-- represented, because a double period may not span a break.

CREATE TABLE public.day_templates (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    name text NOT NULL,
    template_type text NOT NULL DEFAULT 'regular',
    status text NOT NULL DEFAULT 'active',
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT day_templates_type_check CHECK (template_type = ANY (ARRAY[
        'regular','saturday','exam','activity','half_day'
    ]::text[])),
    CONSTRAINT day_templates_status_check CHECK (status = ANY (ARRAY['active','archived']::text[]))
);
CREATE UNIQUE INDEX idx_day_templates_school_name ON public.day_templates (school_id, lower(name));

CREATE TABLE public.period_slot_defs (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    day_template_id uuid NOT NULL REFERENCES public.day_templates(id) ON DELETE CASCADE,
    -- Ordering across the WHOLE day including non-teaching slots.
    slot_index integer NOT NULL,
    kind text NOT NULL,
    -- Teaching periods only: 1..P, contiguous. NULL for assembly/break.
    period_number integer,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    label text,
    CONSTRAINT period_slot_defs_kind_check CHECK (kind = ANY (ARRAY[
        'period','assembly','break','lunch'
    ]::text[])),
    -- A teaching period must be numbered; a non-teaching one must not be.
    CONSTRAINT period_slot_defs_numbering_check CHECK (
        (kind = 'period' AND period_number IS NOT NULL) OR
        (kind <> 'period' AND period_number IS NULL)
    ),
    CONSTRAINT period_slot_defs_time_order_check CHECK (end_time > start_time)
);
CREATE UNIQUE INDEX idx_period_slot_defs_order ON public.period_slot_defs (day_template_id, slot_index);
CREATE UNIQUE INDEX idx_period_slot_defs_number ON public.period_slot_defs (day_template_id, period_number)
    WHERE period_number IS NOT NULL;

-- Which day template a given section follows on a given weekday.
-- Junior/senior split and "Saturday is different" both fall out of this
-- one table rather than needing two separate concepts.
CREATE TABLE public.section_day_templates (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    section_id uuid NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
    day_of_week integer NOT NULL,
    day_template_id uuid NOT NULL REFERENCES public.day_templates(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT section_day_templates_dow_check CHECK (day_of_week BETWEEN 1 AND 6)
);
CREATE UNIQUE INDEX idx_section_day_templates ON public.section_day_templates (section_id, day_of_week);

-- ═══════════════════════════════════════════════════════════════
-- 3. SUBJECT SCHEDULING METADATA
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.subjects
    -- Required resource type; NULL means the section's own homeroom.
    ADD COLUMN room_type text,
    -- {preferMorning, avoidPeriod1, avoidPostLunch, preferLast} — soft
    -- constraints the generator weighs, never hard rules.
    ADD COLUMN placement jsonb,
    -- Co-curricular/activity subjects are excluded from "is this class
    -- academically loaded" style reporting and from remedial rollups.
    ADD COLUMN subject_type text NOT NULL DEFAULT 'core';

ALTER TABLE public.subjects
    ADD CONSTRAINT subjects_room_type_check CHECK (room_type IS NULL OR room_type = ANY (ARRAY[
        'classroom','science_lab','computer_lab','library','ground',
        'music_room','art_room','av_room','auditorium'
    ]::text[])),
    ADD CONSTRAINT subjects_subject_type_check CHECK (subject_type = ANY (ARRAY[
        'core','language','co_curricular','activity','lab','vocational','remedial'
    ]::text[]));

-- ═══════════════════════════════════════════════════════════════
-- 4. TEACHER CAPABILITY AND WORKLOAD
-- ═══════════════════════════════════════════════════════════════
-- staff_profiles.subjects text[] (20260824000000) was the first attempt
-- at "what does this teacher teach". It cannot express the thing the
-- substitute ranking ladder actually needs: that a teacher is a Maths
-- specialist, can cover Science at a push, and should never be handed
-- Class VIII Sanskrit. priority 1/2/3 is that distinction. The text[]
-- column stays as the fallback for teachers nobody has profiled yet.

CREATE TABLE public.teacher_capabilities (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    teacher_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
    -- 1 = primary qualification, 2 = can teach comfortably,
    -- 3 = can supervise/hold the class.
    priority integer NOT NULL DEFAULT 1,
    -- Against classes.numeric_level. NULL = any class.
    min_class_level integer,
    max_class_level integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_capabilities_priority_check CHECK (priority BETWEEN 1 AND 3)
);
CREATE UNIQUE INDEX idx_teacher_capabilities ON public.teacher_capabilities (teacher_id, subject_id);
CREATE INDEX idx_teacher_capabilities_subject ON public.teacher_capabilities (school_id, subject_id, priority);

-- Defaults here are deliberately loose. They are overwritten per school
-- at import time from what that school's timetable ALREADY does (see
-- the importer's constraint derivation): a school running 8 consecutive
-- periods will not tolerate an app that flags every teacher on day one,
-- and alerts that fire on everyone get switched off and never read.
CREATE TABLE public.teacher_constraints (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    teacher_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    max_periods_per_day integer NOT NULL DEFAULT 8,
    max_periods_per_week integer NOT NULL DEFAULT 45,
    min_periods_per_week integer NOT NULL DEFAULT 0,
    max_consecutive integer NOT NULL DEFAULT 4,
    arrangement_cap_per_day integer NOT NULL DEFAULT 2,
    arrangement_cap_per_week integer NOT NULL DEFAULT 6,
    exempt_from_arrangements boolean NOT NULL DEFAULT false,
    -- {"blocked":[{"day":2,"period":1}]} — recurring personal
    -- unavailability (commute, approved outside duty, part-time window).
    availability jsonb,
    notes text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_constraints_positive_check CHECK (
        max_periods_per_day > 0 AND max_periods_per_week > 0 AND max_consecutive > 0
        AND min_periods_per_week >= 0
        AND arrangement_cap_per_day >= 0 AND arrangement_cap_per_week >= 0
    )
);
CREATE UNIQUE INDEX idx_teacher_constraints ON public.teacher_constraints (teacher_id);

-- ═══════════════════════════════════════════════════════════════
-- 5. THE PLAN — how many periods of what, taught by whom
-- ═══════════════════════════════════════════════════════════════
-- The grid is the OUTPUT. This is the input, and without it there is
-- nothing to generate from and no way to answer "is VIII-A short two
-- Maths periods this week". section_id NULL means the row applies to
-- every section of the class.

CREATE TABLE public.class_subject_plan (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    section_id uuid REFERENCES public.sections(id) ON DELETE CASCADE,
    subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
    weekly_periods integer NOT NULL DEFAULT 0,
    -- Number of DOUBLE blocks per week. Each consumes two adjacent
    -- teaching periods and counts as 2 toward weekly_periods.
    double_periods integer NOT NULL DEFAULT 0,
    teacher_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT class_subject_plan_counts_check CHECK (
        weekly_periods >= 0 AND double_periods >= 0 AND double_periods * 2 <= weekly_periods
    )
);
-- One row per (section, subject). The partial index handles section_id
-- NULL, which Postgres would otherwise treat as always-distinct and let
-- through as a duplicate class-wide row.
CREATE UNIQUE INDEX idx_class_subject_plan_section ON public.class_subject_plan (section_id, subject_id)
    WHERE section_id IS NOT NULL;
CREATE UNIQUE INDEX idx_class_subject_plan_class ON public.class_subject_plan (class_id, subject_id)
    WHERE section_id IS NULL;
CREATE INDEX idx_class_subject_plan_teacher ON public.class_subject_plan (school_id, teacher_id);

-- ═══════════════════════════════════════════════════════════════
-- 6. VERSIONS AND DRAFTS
-- ═══════════════════════════════════════════════════════════════
-- timetable_periods stays exactly what every existing consumer already
-- assumes it is: THE LIVE TIMETABLE. Drafts live in their own table so
-- that generating a candidate can never leak into the teacher's view,
-- the homework scoping in /academics/my-classes, or the attendance
-- cross-check — none of which filter by version and none of which
-- should have to learn to.

CREATE TABLE public.timetable_versions (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    academic_year_id uuid REFERENCES public.academic_years(id),
    label text NOT NULL,
    status text NOT NULL DEFAULT 'draft',
    effective_from date,
    -- Engine quality score; lower is better. NULL for hand-built or imported.
    score integer,
    generated_at timestamp with time zone,
    -- Rows replaced when this version was published, so a bad publish
    -- can be rolled back without a database restore.
    replaced_snapshot jsonb,
    source text NOT NULL DEFAULT 'manual',
    notes text,
    created_by uuid REFERENCES public.users(id),
    published_by uuid REFERENCES public.users(id),
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT timetable_versions_status_check CHECK (status = ANY (ARRAY[
        'draft','active','archived'
    ]::text[])),
    CONSTRAINT timetable_versions_source_check CHECK (source = ANY (ARRAY[
        'manual','generated','imported'
    ]::text[]))
);
CREATE INDEX idx_timetable_versions_school ON public.timetable_versions (school_id, status, created_at DESC);

CREATE TABLE public.timetable_draft_periods (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    version_id uuid NOT NULL REFERENCES public.timetable_versions(id) ON DELETE CASCADE,
    class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    section_id uuid REFERENCES public.sections(id) ON DELETE CASCADE,
    day_of_week integer NOT NULL,
    period_number integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
    subject_name text NOT NULL,
    teacher_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    room_id uuid REFERENCES public.classrooms(id) ON DELETE SET NULL,
    is_break boolean NOT NULL DEFAULT false,
    is_locked boolean NOT NULL DEFAULT false,
    is_double_part boolean NOT NULL DEFAULT false,
    CONSTRAINT timetable_draft_periods_dow_check CHECK (day_of_week BETWEEN 1 AND 6)
);
CREATE UNIQUE INDEX idx_timetable_draft_slot
    ON public.timetable_draft_periods (version_id, class_id, section_id, day_of_week, period_number);
CREATE INDEX idx_timetable_draft_teacher ON public.timetable_draft_periods (version_id, teacher_id);

-- ═══════════════════════════════════════════════════════════════
-- 7. LIVE TIMETABLE — new columns
-- ═══════════════════════════════════════════════════════════════
-- subject_name stays. It is what the existing 1,300-line timetable page,
-- /academics/my-classes, homework scoping and syllabus progress all read
-- today, and breaking them to normalise a string is not worth it. New
-- code reads subject_id; subject_name is kept in sync as a display cache.

ALTER TABLE public.timetable_periods
    ADD COLUMN subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
    ADD COLUMN room_id uuid REFERENCES public.classrooms(id) ON DELETE SET NULL,
    ADD COLUMN is_locked boolean NOT NULL DEFAULT false,
    ADD COLUMN is_double_part boolean NOT NULL DEFAULT false,
    ADD COLUMN version_id uuid REFERENCES public.timetable_versions(id) ON DELETE SET NULL;

CREATE INDEX idx_timetable_periods_teacher_day
    ON public.timetable_periods (school_id, teacher_id, day_of_week) WHERE NOT is_break;
CREATE INDEX idx_timetable_periods_subject ON public.timetable_periods (school_id, subject_id);

-- ═══════════════════════════════════════════════════════════════
-- 8. ABSENCES
-- ═══════════════════════════════════════════════════════════════
-- Three intake paths land here: a manager marking someone absent, an
-- approved HRMS leave synced forward, and the attendance cross-check
-- noticing that a teacher with a period running has never checked in.
-- The last one is why `source` exists and why `confirmed` does: a
-- detected absence is a PROPOSAL until a human agrees.

CREATE TABLE public.teacher_absences (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    teacher_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    absence_date date NOT NULL,
    scope text NOT NULL DEFAULT 'full_day',
    -- Only when scope = 'periods'.
    periods integer[] NOT NULL DEFAULT '{}'::integer[],
    -- Only when scope = 'early_leave' (leaves FROM this period onward)
    -- or 'late_arrival' (absent UP TO but excluding this period).
    from_period integer,
    source text NOT NULL DEFAULT 'manual',
    status text NOT NULL DEFAULT 'confirmed',
    leave_request_id uuid REFERENCES public.leave_requests(id) ON DELETE SET NULL,
    reason text,
    created_by uuid REFERENCES public.users(id),
    cancelled_at timestamp with time zone,
    cancelled_by uuid REFERENCES public.users(id),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_absences_scope_check CHECK (scope = ANY (ARRAY[
        'full_day','first_half','second_half','periods','early_leave','late_arrival'
    ]::text[])),
    CONSTRAINT teacher_absences_source_check CHECK (source = ANY (ARRAY[
        'manual','leave','attendance','self_report'
    ]::text[])),
    CONSTRAINT teacher_absences_status_check CHECK (status = ANY (ARRAY[
        'proposed','confirmed','cancelled'
    ]::text[])),
    CONSTRAINT teacher_absences_from_period_check CHECK (
        (scope IN ('early_leave','late_arrival') AND from_period IS NOT NULL)
        OR (scope NOT IN ('early_leave','late_arrival'))
    )
);
-- One live absence per teacher per day. A cancelled one does not block a
-- re-entry, which is what the partial predicate buys.
CREATE UNIQUE INDEX idx_teacher_absences_live
    ON public.teacher_absences (teacher_id, absence_date) WHERE status <> 'cancelled';
CREATE INDEX idx_teacher_absences_date ON public.teacher_absences (school_id, absence_date, status);

-- ═══════════════════════════════════════════════════════════════
-- 9. ARRANGEMENTS
-- ═══════════════════════════════════════════════════════════════
-- An arrangement is an OVERLAY on a date, never an edit to the master
-- timetable. The class view renders today's overlay in a distinct
-- colour; the master grid stays exactly as published, which is what
-- makes the register defensible when someone disputes who was told to
-- cover what.

CREATE TABLE public.arrangements (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    arrangement_date date NOT NULL,
    absence_id uuid REFERENCES public.teacher_absences(id) ON DELETE CASCADE,
    timetable_period_id uuid REFERENCES public.timetable_periods(id) ON DELETE CASCADE,
    day_of_week integer NOT NULL,
    period_number integer NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
    section_id uuid REFERENCES public.sections(id) ON DELETE CASCADE,
    subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
    subject_name text,
    absent_teacher_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    substitute_teacher_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'unassigned',
    -- Snapshot of WHY this substitute was picked, frozen at assign time.
    -- The ranking inputs change hourly; the justification must not.
    reason text,
    rank_score integer,
    assigned_by uuid REFERENCES public.users(id),
    assigned_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    declined_at timestamp with time zone,
    decline_reason text,
    reminder_sent_at timestamp with time zone,
    escalated_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT arrangements_status_check CHECK (status = ANY (ARRAY[
        'unassigned','assigned','acknowledged','declined','cancelled','unfilled'
    ]::text[])),
    CONSTRAINT arrangements_dow_check CHECK (day_of_week BETWEEN 1 AND 6)
);
-- One arrangement per live timetable slot per date. Re-running the
-- materializer for the same absence is therefore idempotent.
CREATE UNIQUE INDEX idx_arrangements_slot_date
    ON public.arrangements (arrangement_date, timetable_period_id)
    WHERE timetable_period_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX idx_arrangements_date ON public.arrangements (school_id, arrangement_date, status);
CREATE INDEX idx_arrangements_substitute ON public.arrangements (substitute_teacher_id, arrangement_date);
CREATE INDEX idx_arrangements_absent ON public.arrangements (absent_teacher_id, arrangement_date);
-- The escalation sweep's working set: assigned but not yet acknowledged.
CREATE INDEX idx_arrangements_pending_ack ON public.arrangements (school_id, assigned_at)
    WHERE status = 'assigned';

-- ═══════════════════════════════════════════════════════════════
-- 10. TEACHER FREE-PERIOD BOOKINGS
-- ═══════════════════════════════════════════════════════════════
-- A teacher reserving their own free period for copy correction or
-- event work. This is a HARD block against routine scheduling and a
-- STRONG SOFT block against arrangements — deliberately not an absolute
-- one. In a school where six people hold most of the slack, letting
-- anyone hard-block any free period at any time means a heavy-absence
-- morning has nobody left to teach. Guardrails (lead time, weekly cap)
-- live in timetable_settings; the override is permission-gated.

CREATE TABLE public.period_bookings (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    teacher_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    booking_date date NOT NULL,
    period_number integer NOT NULL,
    day_of_week integer NOT NULL,
    purpose text NOT NULL,
    notes text,
    status text NOT NULL DEFAULT 'active',
    overridden_by uuid REFERENCES public.users(id),
    overridden_at timestamp with time zone,
    override_reason text,
    released_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT period_bookings_purpose_check CHECK (purpose = ANY (ARRAY[
        'copy_correction','lesson_planning','event_management','parent_meeting',
        'remedial','administrative','other'
    ]::text[])),
    CONSTRAINT period_bookings_status_check CHECK (status = ANY (ARRAY[
        'active','released','overridden'
    ]::text[])),
    CONSTRAINT period_bookings_dow_check CHECK (day_of_week BETWEEN 1 AND 6)
);
CREATE UNIQUE INDEX idx_period_bookings_live
    ON public.period_bookings (teacher_id, booking_date, period_number) WHERE status = 'active';
CREATE INDEX idx_period_bookings_date ON public.period_bookings (school_id, booking_date) WHERE status = 'active';

-- ═══════════════════════════════════════════════════════════════
-- 11. PER-SCHOOL SETTINGS
-- ═══════════════════════════════════════════════════════════════
-- Every number here is one a real school will argue about. None of them
-- belong in code.

CREATE TABLE public.timetable_settings (
    school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
    -- Minutes after assignment before the substitute is reminded, and
    -- before the manager and principal are told nobody has acknowledged.
    ack_reminder_minutes integer NOT NULL DEFAULT 15,
    ack_escalate_minutes integer NOT NULL DEFAULT 30,
    -- A booking must be created this many hours before the period starts.
    -- Stops a teacher booking reactively to dodge cover they can see coming.
    booking_lead_hours integer NOT NULL DEFAULT 12,
    booking_weekly_cap integer NOT NULL DEFAULT 4,
    -- Working days, 1=Mon..6=Sat.
    working_days integer[] NOT NULL DEFAULT '{1,2,3,4,5,6}'::integer[],
    -- Whether exceeding max_consecutive blocks a save or merely warns.
    -- Schools genuinely differ, and one already running 8-in-a-row will
    -- not accept a hard block.
    enforce_max_consecutive boolean NOT NULL DEFAULT false,
    -- Auto-propose an absence when a teacher with a period running has
    -- no check-in. Always a proposal; never silently confirmed.
    auto_detect_absence boolean NOT NULL DEFAULT true,
    auto_detect_after_period integer NOT NULL DEFAULT 1,
    -- Working days after which daily arrangements stop being sensible
    -- and the teacher's load should be redistributed instead.
    long_absence_threshold_days integer NOT NULL DEFAULT 10,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT timetable_settings_positive_check CHECK (
        ack_reminder_minutes > 0 AND ack_escalate_minutes > ack_reminder_minutes
        AND booking_lead_hours >= 0 AND booking_weekly_cap >= 0
        AND long_absence_threshold_days > 0
    )
);

-- ═══════════════════════════════════════════════════════════════
-- 12. AUDIT
-- ═══════════════════════════════════════════════════════════════
-- Arrangements are the single most disputed thing in a staffroom
-- ("nobody told me"). The register is what protects the timetable
-- manager, so every state change that touches a teacher's day is
-- recorded with who did it.

CREATE TABLE public.timetable_audit_log (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    actor_id uuid REFERENCES public.users(id),
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX idx_timetable_audit_school ON public.timetable_audit_log (school_id, created_at DESC);
CREATE INDEX idx_timetable_audit_entity ON public.timetable_audit_log (entity_type, entity_id);
