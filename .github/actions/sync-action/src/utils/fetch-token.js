const axios = require('axios');
const core = require('@actions/core');

/**
 * @param auth {{key: string, email: string, pass: string, gipTenantId}}
 * @return {Promise<string>}
 */

export async function fetchToken({
  key, email, pass, gipTenantId,
}) {
  try {
    const result = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`,
      {
        email,
        password: pass,
        tenantId: gipTenantId,
        returnSecureToken: true,
      },
    );
    return result.data.idToken;
  } catch (e) {
    core.error(e.message);
    const err = e.response
      ? `code - ${e.response.status}, data - ${JSON.stringify(e.response.data)}`
      : e.message;
    throw new Error(`Could not get auth token from GIP. ${err}`);
  }
}
