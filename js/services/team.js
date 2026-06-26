import { TEAM_MEMBERS, resolveProfileForTeamMember } from '../config.js';
import { profilesApi } from '../api/crud.js?v=20260620c';

let teamWithProfiles = null;
let teamLoadPromise = null;

export async function loadTeamWithProfiles(force = false) {
  if (teamWithProfiles && !force) return teamWithProfiles;
  if (teamLoadPromise && !force) return teamLoadPromise;

  teamLoadPromise = (async () => {
    const profiles = await profilesApi.list({ order: { column: 'full_name', asc: true } });
    teamWithProfiles = TEAM_MEMBERS.map(member => ({
      ...member,
      profile: resolveProfileForTeamMember(member, profiles)
    }));
    return teamWithProfiles;
  })();

  return teamLoadPromise;
}

export function getTeamWithProfiles() {
  return teamWithProfiles || [];
}
