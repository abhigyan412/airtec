-- ── Native push devices alongside web push ───────────────────────────
--
-- The app is wrapped by Median, whose webview has no Web Push API at all
-- (no PushManager, no service-worker push), so every device inside the
-- wrapper reported "this browser cannot show notifications" and nothing
-- was ever deliverable to it. Median pushes natively through OneSignal to
-- APNs/FCM instead, which is a second transport, not a second table:
-- a device is still one row, still owned by a user, still retired the
-- same way when its far end goes away.
--
-- `endpoint` carries the OneSignal subscription id for these rows. It is
-- already the table's natural dedupe key and already what the register /
-- reconcile / delete paths key on, so reusing it means the whole
-- "does the server know about THIS device" machinery works unchanged.

ALTER TABLE public.push_subscriptions
    ADD COLUMN provider text NOT NULL DEFAULT 'webpush'
        CHECK (provider IN ('webpush', 'onesignal'));

-- OneSignal rows have no VAPID key material — the OS holds the token.
ALTER TABLE public.push_subscriptions ALTER COLUMN p256dh DROP NOT NULL;
ALTER TABLE public.push_subscriptions ALTER COLUMN auth   DROP NOT NULL;

-- ...but a webpush row without keys is undeliverable, and silently so.
-- The NOT NULLs above were the only thing preventing that; keep the
-- guarantee for the rows that still need it.
ALTER TABLE public.push_subscriptions
    ADD CONSTRAINT push_subs_webpush_needs_keys CHECK (
        provider <> 'webpush' OR (p256dh IS NOT NULL AND auth IS NOT NULL)
    );

-- Delivery fans out per provider, so it reads one user's devices and
-- splits them. Narrow the existing user index to match.
DROP INDEX IF EXISTS idx_push_subs_user;
CREATE INDEX idx_push_subs_user ON public.push_subscriptions (user_id, provider)
    WHERE failed_at IS NULL;
