-- Staff profile photo upload (POST /hrms/staff/:user_id/photo), same
-- base64 -> storage bucket -> getPublicUrl() shape as student photos and
-- staff documents. staff_profiles.photo_url already exists (it's been in
-- StaffProfileSchema since the profile route was built) — the bucket to
-- hold the files was the only missing piece.

insert into storage.buckets (id, name, public)
values ('staff-photos', 'staff-photos', true)
on conflict (id) do nothing;
