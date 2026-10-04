import './style.css';
import { boot } from './app/app';

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('time-readout');
  if (el) el.textContent = 'Something went wrong loading the atlas.';
});
