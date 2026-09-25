import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { Privacy } from './Privacy';
import { Terms } from './Terms';

const page = document.getElementById('root')!.dataset.page;

createRoot(document.getElementById('root')!).render(
  <StrictMode>{page === 'terminos' ? <Terms /> : <Privacy />}</StrictMode>,
);
