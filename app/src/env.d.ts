/// <reference path="../.astro/types.d.ts" />

// Ambient declarations for our Astro.locals shape so route files get
// typed access to whatever middleware attaches. Defined as part of the
// App namespace per Astro convention.

declare namespace App {
  interface Locals {
    /** Resolved tenant for public-host requests. Undefined on admin host. */
    tenant?: import('./lib/db/sites').SiteHostMatch;
    /** Session info if a valid riovv_sid cookie was presented. */
    session?: {
      sessionId: string;
      userId: string;
      githubLogin: string;
    };
    /** SqlDriver bound for this request. */
    db?: import('./lib/db/driver').SqlDriver;
  }
}
