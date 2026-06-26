-- Corrige login de usuários criados via seed (GoTrue não aceita NULL em colunas string)
UPDATE auth.users SET
  email_change = COALESCE(email_change, ''),
  recovery_token = COALESCE(recovery_token, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  phone_change = COALESCE(phone_change, ''),
  phone_change_token = COALESCE(phone_change_token, ''),
  reauthentication_token = COALESCE(reauthentication_token, ''),
  confirmation_token = COALESCE(confirmation_token, '')
WHERE
  email_change IS NULL OR recovery_token IS NULL OR email_change_token_new IS NULL
  OR email_change_token_current IS NULL OR phone_change IS NULL
  OR phone_change_token IS NULL OR reauthentication_token IS NULL
  OR confirmation_token IS NULL;

CREATE OR REPLACE FUNCTION public.seed_team_user(
  p_email TEXT,
  p_password TEXT,
  p_full_name TEXT,
  p_role public.user_role DEFAULT 'colaborador'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id UUID;
  v_encrypted_pw TEXT;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = lower(p_email) LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    UPDATE auth.users SET email_change = COALESCE(email_change, '') WHERE id = v_user_id;
    UPDATE public.profiles
    SET full_name = p_full_name, role = p_role, email = lower(p_email), is_active = true
    WHERE id = v_user_id;
    RETURN v_user_id;
  END IF;

  v_user_id := gen_random_uuid();
  v_encrypted_pw := crypt(p_password, gen_salt('bf'));

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, email_change, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, is_super_admin
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    lower(p_email),
    v_encrypted_pw,
    now(),
    '',
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', p_full_name),
    now(),
    now(),
    '',
    false
  );

  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at, id
  ) VALUES (
    lower(p_email),
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', lower(p_email), 'email_verified', true),
    'email',
    now(),
    now(),
    now(),
    gen_random_uuid()
  );

  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (v_user_id, lower(p_email), p_full_name, p_role, true)
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, email = EXCLUDED.email, is_active = true;

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_team_user(TEXT, TEXT, TEXT, public.user_role) FROM PUBLIC, anon, authenticated;
