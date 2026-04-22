// Extract token from URL ?token=...
const urlParams = new URLSearchParams(window.location.search);
const tokenVal = urlParams.get('token');

if (!tokenVal) {
    const joinForm = document.getElementById('joinForm');
    const joinError = document.getElementById('joinError');
    if (joinForm) joinForm.style.display = 'none';
    if (joinError) {
        joinError.textContent = 'Invalid or missing invitation link. Please check your email and try again.';
        joinError.classList.remove('hidden');
    }
} else {
    const tokenInput = document.getElementById('token');
    if (tokenInput) tokenInput.value = tokenVal;
}

const joinForm = document.getElementById('joinForm');
if (joinForm) {
    joinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      const errBox = document.getElementById('joinError');
      if (!btn || !errBox) return;

      btn.disabled = true;
      btn.textContent = 'Joining...';
      errBox.classList.add('hidden');

      const token = document.getElementById('token').value;
      const password = document.getElementById('password').value;

      try {
        const res = await fetch('/api/auth/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ token, password })
        });
        const data = await res.json();
        if (res.ok) {
          // The server set an HttpOnly + Secure cookie. Do not persist the token client-side.
          window.location.href = data.data?.redirect || '/dashboard';
        } else {
          errBox.textContent = data.error || 'Failed to join workspace.';
          errBox.classList.remove('hidden');
          btn.disabled = false;
          btn.textContent = 'Accept Invitation';
        }
      } catch(err) {
        errBox.textContent = 'Network error occurred.';
        errBox.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Accept Invitation';
      }
    });
}
