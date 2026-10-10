import { supabase, getUser } from './supabase-client.js';

let isLogin = true;
const form = document.getElementById('auth-form');
const toggleMode = document.getElementById('toggle-mode');
const submitBtn = document.getElementById('submit-btn');
const errorMsg = document.getElementById('error-msg');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');

// Check if already logged in
getUser().then(user => {
  if (user) {
    window.location.href = '/dashboard.html';
  }
});

toggleMode.addEventListener('click', (e) => {
  e.preventDefault();
  isLogin = !isLogin;
  submitBtn.textContent = isLogin ? 'Login' : 'Sign Up';
  toggleMode.textContent = isLogin ? 'Need an account? Sign Up' : 'Already have an account? Login';
  errorMsg.textContent = '';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Loading...';
  errorMsg.textContent = '';

  const email = emailInput.value;
  const password = passwordInput.value;

  try {
    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.href = '/dashboard.html';
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      // Depending on confirm setting, might need to tell user to check email
      window.location.href = '/dashboard.html';
    }
  } catch (err) {
    errorMsg.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = isLogin ? 'Login' : 'Sign Up';
  }
});

