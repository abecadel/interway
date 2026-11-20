import { useEffect, useState } from 'react';

/** Chrome's install event (not in the DOM typings). */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** An install function while the browser offers to install the app, else null. */
export function useInstallPrompt(win: Window = window): (() => Promise<void>) | null {
  const [offer, setOffer] = useState<InstallPromptEvent | null>(null);
  useEffect(() => {
    const onOffer = (e: Event) => {
      e.preventDefault(); // keep the browser's own mini-infobar away; the app shows its button instead
      setOffer(e as InstallPromptEvent);
    };
    const onInstalled = () => setOffer(null);
    win.addEventListener('beforeinstallprompt', onOffer);
    win.addEventListener('appinstalled', onInstalled);
    return () => {
      win.removeEventListener('beforeinstallprompt', onOffer);
      win.removeEventListener('appinstalled', onInstalled);
    };
  }, [win]);
  if (!offer) return null;
  return async () => {
    setOffer(null); // an install event can be used once
    await offer.prompt();
    await offer.userChoice;
  };
}
