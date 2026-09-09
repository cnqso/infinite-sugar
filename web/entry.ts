// A fresh page is a fresh fly. Load the simulation only after it has a name.
const form = document.getElementById('name-form');
const input = document.getElementById('fly-name');
const loading = document.getElementById('loading');
const error = document.getElementById('name-error');
if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement) || !loading || !error) {
  throw new Error('Missing naming screen');
}
let starting = false;
input.addEventListener('input', () => { input.setCustomValidity(''); error.textContent = ''; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (starting) return;
  const name = input.value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) {
    error.textContent = 'Please give the fly a name.';
    input.setCustomValidity('Please give the fly a name.');
    input.reportValidity();
    return;
  }
  starting = true;
  document.body.dataset.namedFly = name;
  for (const label of document.querySelectorAll('[data-fly-name]')) label.textContent = name;
  document.title = `${name} · Infinite Sugar`;
  const home = document.getElementById('b_home');
  home?.setAttribute('aria-label', `Return to ${name}`);
  home?.setAttribute('title', `Return to ${name}`);
  document.getElementById('artwork')?.setAttribute('aria-label', `${name}, a live simulated fruit fly in a terrarium`);
  input.blur();
  form.hidden = true;
  loading.hidden = false;
  try {
    await import('./app.js');
  } catch (err) {
    console.error(err);
    const message = document.getElementById('bootmsg');
    if (message) message.textContent = 'The simulation could not load. Please reload to try again.';
    loading.setAttribute('role', 'alert');
  }
});
