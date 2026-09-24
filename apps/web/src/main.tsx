import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import './styles.css';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { CACHE_MAX_AGE_MS, persister, queryClient } from './query';

// The shell-only service worker: the installed app opens without signal (docs/03 §4).
registerSW({ immediate: true });

// Ask Safari to exempt this origin from eviction; an installed app is one of WebKit's grounds for
// granting it (docs/03 §11). `docs/11` §3 item 1 checks the answer on a real iPhone.
void navigator.storage?.persist?.();

const root = document.getElementById('root');
if (root === null) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: CACHE_MAX_AGE_MS }}
    >
      <div className="app">
        <App />
      </div>
    </PersistQueryClientProvider>
  </StrictMode>,
);
