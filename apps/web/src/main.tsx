import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import './styles.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { openCache, queryClient } from './query';

// The shell-only service worker: the installed app opens without signal (docs/03 §4).
registerSW({ immediate: true });

// Ask Safari to exempt this origin from eviction; an installed app is one of WebKit's grounds for
// granting it (docs/03 §11). `docs/11` §3 item 1 checks the answer on a real iPhone.
void navigator.storage?.persist?.();

const root = document.getElementById('root');
if (root === null) throw new Error('#root is missing from index.html');

// The saved copy is loaded before the first render, so no query runs against an empty cache first.
void openCache().then(() =>
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <div className="app">
          <App />
        </div>
      </QueryClientProvider>
    </StrictMode>,
  ),
);
