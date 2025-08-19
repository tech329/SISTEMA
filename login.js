// login.js — login con tokens (robusto a todas las variantes)
import { DIRECTUS_URL, getClient, saveTokens } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
  const loginForm     = document.getElementById('login-form');
  const emailInput    = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const errorMessage  = document.getElementById('error-message');
  const submitButton  = loginForm.querySelector('button[type="submit"]');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitButton.disabled = true;
    submitButton.textContent = 'Verificando...';
    errorMessage.classList.add('hidden');

    try {
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const client = getClient();

      // 1) Intento normal con SDK
      let resp = await client.login({ email, password });

      // --- Unificamos todas las variantes de respuesta ---
      let access_token =
        resp?.access_token ??
        resp?.data?.access_token ?? null;

      let refresh_token =
        resp?.refresh_token ??
        resp?.data?.refresh_token ?? null;

      // 2) Si no vinieron en la respuesta, intenta leerlos del cliente
      if (!access_token || !refresh_token) {
        try {
          const t = await client.getToken?.();
          const r = await client.getRefreshToken?.();
          if (t && r) { access_token = t; refresh_token = r; }
        } catch { /* sigue el fallback */ }
      }

      // 3) Fallback duro: llamar al endpoint REST /auth/login
      if (!access_token || !refresh_token) {
        const res = await fetch(`${DIRECTUS_URL.replace(/\/$/,'')}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(()=> '');
          throw new Error(`Login REST falló (${res.status}). ${txt.slice(0,200)}`);
        }
        const json = await res.json();
        access_token  = json?.data?.access_token ?? json?.access_token ?? null;
        refresh_token = json?.data?.refresh_token ?? json?.refresh_token ?? null;
      }

      if (!access_token || !refresh_token) {
        throw new Error('No se recibieron tokens (ninguna variante)');
      }

      // 4) Guardar tokens y redirigir
      saveTokens({ access_token, refresh_token });
      location.href = 'app.html';
    } catch (err) {
      errorMessage.textContent = 'Error: ' + (err?.message || 'No se pudo iniciar sesión');
      errorMessage.classList.remove('hidden');
      submitButton.disabled = false;
      submitButton.textContent = 'Ingresar';
    }
  });
});
