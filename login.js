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
    
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    
    await attemptLogin(email, password);
  });

  async function attemptLogin(email, password, retryCount = 0) {
    const maxRetries = 2;
    const isRetry = retryCount > 0;
    
    // Update UI based on attempt
    submitButton.disabled = true;
    errorMessage.classList.add('hidden');
    
    if (retryCount === 0) {
      submitButton.textContent = 'Verificando...';
    } else if (retryCount === 1) {
      submitButton.textContent = 'Conectando...';
    } else {
      submitButton.textContent = 'Validando...';
    }

    try {
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
      
      // Success feedback
      submitButton.textContent = 'Accediendo...';
      submitButton.classList.remove('bg-blue-600', 'hover:bg-blue-700');
      submitButton.classList.add('bg-green-600');
      
      // Small delay for user feedback, then redirect
      setTimeout(() => {
        location.href = 'app.html';
      }, 500);
      
    } catch (err) {
      console.log(`Login attempt ${retryCount + 1} failed:`, err);
      
      // Check if it's a network/temporary error that we should retry
      const isNetworkError = err?.message?.includes('fetch') || 
                            err?.message?.includes('Network') || 
                            err?.message?.includes('Failed to fetch') ||
                            err?.name === 'TypeError' ||
                            err?.message?.includes('Unexpected');
      
      const isCredentialError = err?.message?.includes('Invalid') ||
                               err?.message?.includes('Unauthorized') ||
                               err?.message?.includes('credentials') ||
                               err?.status === 401;
      
      // If it's a network error and we haven't exceeded max retries, try again
      if (isNetworkError && retryCount < maxRetries) {
        console.log(`Retrying login automatically (attempt ${retryCount + 2}/${maxRetries + 1})...`);
        
        // Wait a bit before retry (increasing delay)
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        
        // Retry automatically
        await attemptLogin(email, password, retryCount + 1);
        return;
      }
      
      // Show appropriate error message
      let errorText;
      if (isCredentialError) {
        errorText = 'Credenciales incorrectas. Verifique su email y contraseña.';
      } else if (isNetworkError) {
        errorText = 'Error de conexión. Verifique su conexión a internet y reintente.';
      } else {
        errorText = `Error: ${err?.message || 'No se pudo iniciar sesión'}`;
      }
      
      errorMessage.textContent = errorText;
      errorMessage.classList.remove('hidden');
      
      // Reset button
      submitButton.disabled = false;
      submitButton.textContent = 'Ingresar';
      submitButton.classList.remove('bg-green-600');
      submitButton.classList.add('bg-blue-600', 'hover:bg-blue-700');
      
      // If it was an unexpected error, show a more user-friendly message
      if (retryCount > 0 && isNetworkError) {
        errorMessage.textContent = 'Problema de conexión persistente. Reintente en unos momentos.';
      }
    }
  }
});
