import { supabase, getUser } from './supabase-client.js';

const loginBtn = document.getElementById('login-btn');
const errorMsg = document.getElementById('error-msg');

// Check if already logged in
getUser().then(user => {
  if (user) {
    window.location.href = '/dashboard.html';
  }
});

loginBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  loginBtn.disabled = true;
  loginBtn.textContent = 'Redirecting to DarwinIdP...';
  errorMsg.textContent = '';

  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'keycloak',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) throw error;
  } catch (err) {
    errorMsg.textContent = err.message;
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login via DarwinIdP';
  }
});

