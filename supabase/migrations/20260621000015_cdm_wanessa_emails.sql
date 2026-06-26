-- Usuário CDM Marketing + e-mail Gmail da Wanessa

SELECT public.seed_team_user('cdm@cdmmkt.com.br', 'Mariah775566', 'CDM Marketing', 'admin');

DO $$
DECLARE
  v_wanessa_id UUID := '1cf624cf-5d18-4dac-80de-bacecf44d690';
  v_new_email TEXT := 'wanessasilvawg977@gmail.com';
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_wanessa_id) THEN
    UPDATE auth.users
    SET email = v_new_email, email_change = COALESCE(email_change, '')
    WHERE id = v_wanessa_id;

    UPDATE auth.identities
    SET
      provider_id = v_new_email,
      identity_data = jsonb_build_object(
        'sub', v_wanessa_id::text,
        'email', v_new_email,
        'email_verified', true
      )
    WHERE user_id = v_wanessa_id AND provider = 'email';

    UPDATE public.profiles
    SET email = v_new_email, full_name = 'Wanessa', is_active = true
    WHERE id = v_wanessa_id;
  ELSE
    PERFORM public.seed_team_user(v_new_email, 'Mariah775566', 'Wanessa', 'admin');
  END IF;
END;
$$;

UPDATE public.tasks t
SET assigned_to = p.id
FROM public.profiles p
WHERE t.assigned_to IS NULL
  AND t.assignee_name IS NOT NULL
  AND lower(t.assignee_name) LIKE '%waness%'
  AND lower(p.email) = 'wanessasilvawg977@gmail.com';
