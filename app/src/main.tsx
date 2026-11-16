import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RoutingClient } from './routing/client'
import { registerServiceWorker } from './offline/register'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App client={new RoutingClient()} />
  </StrictMode>,
)

void registerServiceWorker(navigator, import.meta.env.PROD, `${import.meta.env.BASE_URL}sw.js`)
