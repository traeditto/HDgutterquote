"use client"

import Script from "next/script"
import { useEffect } from "react"
import { META_PIXEL_ID } from "@/lib/meta-pixel"

/**
 * Injects the Meta (Facebook) Pixel base code and fires PageView on every
 * website visit. The PageView carries a shared `eventID` that we also send to
 * the server-side Conversions API (/api/track/pageview) so Meta deduplicates
 * the browser and server PageView into one. Renders nothing when
 * NEXT_PUBLIC_META_PIXEL_ID is not set, so the app works before configuration.
 */
export function MetaPixel() {
  useEffect(() => {
    if (!META_PIXEL_ID) return
    // Mirror the browser PageView to CAPI using the shared id the inline script
    // stashed on window. Delay briefly so the pixel can set the _fbp/_fbc
    // cookies first, improving server-side match quality. Fire-and-forget.
    const timer = window.setTimeout(() => {
      const eventId = window.__metaPageViewId
      if (!eventId) return
      const body = JSON.stringify({
        eventId,
        eventSourceUrl: window.location.href,
      })
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(
            "/api/track/pageview",
            new Blob([body], { type: "application/json" }),
          )
        } else {
          void fetch("/api/track/pageview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
          })
        }
      } catch {
        // Ignore — tracking must never affect the page.
      }
    }, 800)
    return () => window.clearTimeout(timer)
  }, [])

  if (!META_PIXEL_ID) return null

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${META_PIXEL_ID}');
          window.__metaPageViewId = (self.crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2);
          fbq('track', 'PageView', {}, { eventID: window.__metaPageViewId });
        `}
      </Script>
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  )
}
