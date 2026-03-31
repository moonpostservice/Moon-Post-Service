# Requirements Document

## Introduction

MoonPop (Moon Post Service) is a PWA messaging app where messages are gated by moon rise/set times at the recipient's location. The entire application currently lives in a single 21,000-line `index.html` file with all HTML, CSS, and JavaScript inline. The Supabase anon key is exposed client-side with no Row Level Security (RLS) policies, meaning any user with the key can read and write all data in the database. This spec covers a security and architecture overhaul to lock down private data, decompose the monolith into a maintainable project structure, and bring the codebase to production quality.

## Glossary

- **MoonPop_App**: The Moon Post Service PWA, including all client-side code, service worker, and Vercel deployment
- **Supabase_Backend**: The Supabase project providing authentication, PostgreSQL database, storage buckets, and Edge Functions
- **RLS_Policy**: A PostgreSQL Row Level Security policy that restricts which rows a given user can select, insert, update, or delete
- **Anon_Key**: The Supabase anonymous/public API key embedded in client-side code, used to authenticate requests from unauthenticated or authenticated browser sessions
- **Auth_User**: A user who has completed email OTP authentication and has a valid Supabase JWT session
- **Build_System**: The toolchain (bundler, transpiler, dev server) used to compile source modules into deployable assets
- **Module**: A single JavaScript or TypeScript file exporting a cohesive unit of functionality (e.g., a service, a UI component, a utility)
- **Service_Worker**: The `sw.js` file that handles caching, offline support, and push notifications for the PWA
- **Edge_Function**: A Supabase Edge Function running server-side, used for operations that require elevated privileges (service role key)
- **Storage_Bucket**: A Supabase Storage bucket (avatars, moon-photos) used for user-uploaded images

## Requirements

### Requirement 1: Enable Row Level Security on All Tables

**User Story:** As a MoonPop user, I want my private messages and profile data protected at the database level, so that other users cannot read or modify my data even if they have the anon key.

#### Acceptance Criteria

1. THE Supabase_Backend SHALL have RLS enabled on every table: `profiles`, `messages`, `replies`, `contacts`, `shared_sky`, `reactions`, `read_receipts`, `blocked_users`, `moon_circles`, `circle_members`, `circle_nights`, `circle_contributions`
2. WHEN RLS is enabled on a table, THE Supabase_Backend SHALL deny all access by default (no permissive policies exist until explicitly created)
3. WHEN an unauthenticated request is made using the Anon_Key, THE Supabase_Backend SHALL deny access to all tables except `shared_sky` (read-only) and `profiles` (read-only, limited columns)

### Requirement 2: Profiles Table RLS Policies

**User Story:** As a MoonPop user, I want to control who can see and edit my profile, so that my email and private details remain private while my username and avatar are discoverable.

#### Acceptance Criteria

1. WHEN an Auth_User queries the `profiles` table, THE RLS_Policy SHALL allow selecting only the columns `id`, `username`, `first_name`, `last_name`, `city`, `avatar_url` for other users' profiles
2. WHEN an Auth_User queries their own profile row, THE RLS_Policy SHALL allow selecting all columns including `email`
3. WHEN an Auth_User updates the `profiles` table, THE RLS_Policy SHALL allow updates only to the row where `id` matches `auth.uid()`
4. WHEN an Auth_User inserts into the `profiles` table, THE RLS_Policy SHALL allow insertion only where `id` matches `auth.uid()`
5. THE RLS_Policy SHALL deny deletion of profile rows from client-side requests

### Requirement 3: Messages Table RLS Policies

**User Story:** As a MoonPop user, I want only the sender and recipient of a message to be able to read it, so that private moon messages remain confidential.

#### Acceptance Criteria

1. WHEN an Auth_User queries the `messages` table, THE RLS_Policy SHALL return only rows where `sender_id` equals `auth.uid()` OR `recipient_id` equals `auth.uid()` OR `recipient_email` equals the user's email from `auth.jwt()`
2. WHEN an Auth_User inserts into the `messages` table, THE RLS_Policy SHALL allow insertion only where `sender_id` equals `auth.uid()`
3. WHEN an Auth_User updates a message row, THE RLS_Policy SHALL allow updates only where `recipient_id` equals `auth.uid()` OR `recipient_email` equals the user's email (for release status changes)
4. THE RLS_Policy SHALL deny deletion of message rows from client-side requests

### Requirement 4: Replies Table RLS Policies

**User Story:** As a MoonPop user, I want replies to my conversations to be visible only to conversation participants, so that reply threads remain private.

#### Acceptance Criteria

1. WHEN an Auth_User queries the `replies` table, THE RLS_Policy SHALL return only rows where the associated `message_id` references a message the user is a sender or recipient of
2. WHEN an Auth_User inserts into the `replies` table, THE RLS_Policy SHALL allow insertion only where `sender_id` equals `auth.uid()` and the associated `message_id` references a message the user participates in
3. WHEN an Auth_User updates a reply row, THE RLS_Policy SHALL allow updates only where the user is a participant in the associated message conversation (for release status changes)

### Requirement 5: Contacts Table RLS Policies

**User Story:** As a MoonPop user, I want my contact list to be private, so that no other user can see who I communicate with.

#### Acceptance Criteria

1. WHEN an Auth_User queries the `contacts` table, THE RLS_Policy SHALL return only rows where `owner_id` equals `auth.uid()`
2. WHEN an Auth_User inserts into the `contacts` table, THE RLS_Policy SHALL allow insertion only where `owner_id` equals `auth.uid()`
3. WHEN an Auth_User updates or deletes a contact row, THE RLS_Policy SHALL allow the operation only where `owner_id` equals `auth.uid()`

### Requirement 6: Shared Sky Table RLS Policies

**User Story:** As a MoonPop user, I want the Shared Sky public space to be readable by all authenticated users and writable only by the post author, so that the communal space remains open but tamper-proof.

#### Acceptance Criteria

1. WHEN an Auth_User queries the `shared_sky` table, THE RLS_Policy SHALL allow reading all rows
2. WHEN an Auth_User inserts into the `shared_sky` table, THE RLS_Policy SHALL allow insertion only where `user_id` equals `auth.uid()`
3. WHEN an Auth_User updates or deletes a `shared_sky` row, THE RLS_Policy SHALL allow the operation only where `user_id` equals `auth.uid()`

### Requirement 7: Reactions Table RLS Policies

**User Story:** As a MoonPop user, I want to add and remove my own reactions, so that reaction data is authentic and cannot be spoofed.

#### Acceptance Criteria

1. WHEN an Auth_User queries the `reactions` table, THE RLS_Policy SHALL allow reading reactions on messages the user has access to (shared_sky posts or messages the user participates in)
2. WHEN an Auth_User inserts into the `reactions` table, THE RLS_Policy SHALL allow insertion only where `user_id` equals `auth.uid()`
3. WHEN an Auth_User deletes a reaction, THE RLS_Policy SHALL allow deletion only where `user_id` equals `auth.uid()`

### Requirement 8: Read Receipts Table RLS Policies

**User Story:** As a MoonPop user, I want my read receipts to be private and accurate, so that only conversation participants can see read status.

#### Acceptance Criteria

1. WHEN an Auth_User queries the `read_receipts` table, THE RLS_Policy SHALL return only rows where `user_id` equals `auth.uid()` OR the `conversation_id` references a conversation the user participates in
2. WHEN an Auth_User upserts into the `read_receipts` table, THE RLS_Policy SHALL allow the operation only where `user_id` equals `auth.uid()`

### Requirement 9: Blocked Users Table RLS Policies

**User Story:** As a MoonPop user, I want my block list to be private, so that blocked users cannot discover they have been blocked by querying the database.

#### Acceptance Criteria

1. WHEN an Auth_User queries the `blocked_users` table, THE RLS_Policy SHALL return only rows where `blocker_id` equals `auth.uid()`
2. WHEN an Auth_User inserts into the `blocked_users` table, THE RLS_Policy SHALL allow insertion only where `blocker_id` equals `auth.uid()`
3. WHEN an Auth_User deletes from the `blocked_users` table, THE RLS_Policy SHALL allow deletion only where `blocker_id` equals `auth.uid()`

### Requirement 10: Moon Circles Tables RLS Policies

**User Story:** As a MoonPop user, I want Moon Circle data to be accessible only to circle members, so that private circle content stays within the group.

#### Acceptance Criteria

1. WHEN an Auth_User queries the `moon_circles` table, THE RLS_Policy SHALL return only rows where the user is a member of the circle (exists in `circle_members` for that `circle_id`)
2. WHEN an Auth_User queries the `circle_members` table, THE RLS_Policy SHALL return only rows for circles the user is a member of
3. WHEN an Auth_User queries the `circle_nights` or `circle_contributions` tables, THE RLS_Policy SHALL return only rows for circles the user is a member of
4. WHEN an Auth_User inserts into `circle_contributions`, THE RLS_Policy SHALL allow insertion only where `user_id` equals `auth.uid()` and the user is a member of the associated circle
5. WHEN an Auth_User creates a new `moon_circles` row, THE RLS_Policy SHALL allow insertion only where `creator_id` equals `auth.uid()`

### Requirement 11: Storage Bucket Security Policies

**User Story:** As a MoonPop user, I want my uploaded photos to be stored securely, so that only authorized users can upload to my storage path.

#### Acceptance Criteria

1. THE Supabase_Backend SHALL configure the `avatars` Storage_Bucket so that uploads are allowed only to the path `{auth.uid()}/` for authenticated users
2. THE Supabase_Backend SHALL configure the `moon-photos` Storage_Bucket so that uploads are allowed only to paths prefixed with `{context}/{auth.uid()}/` for authenticated users
3. THE Supabase_Backend SHALL allow public read access to both `avatars` and `moon-photos` Storage_Buckets (images are referenced by public URL in messages)
4. THE Supabase_Backend SHALL deny unauthenticated uploads to all Storage_Buckets

### Requirement 12: Move Sensitive Operations to Edge Functions

**User Story:** As a MoonPop user, I want sensitive database operations handled server-side, so that the client cannot bypass business rules or access data it should not.

#### Acceptance Criteria

1. WHEN a message is sent, THE Edge_Function SHALL validate the message payload, enforce rate limits, and insert the message using the service role key
2. WHEN a message release status is updated, THE Edge_Function SHALL verify that the requesting user is the intended recipient before updating the status
3. THE MoonPop_App SHALL remove the direct-insert fallback for messages (the current code falls back to `sb.from('messages').insert()` when the Edge Function fails)
4. IF an Edge_Function receives an invalid or unauthorized request, THEN THE Edge_Function SHALL return an appropriate error response without modifying the database

### Requirement 13: Remove Hardcoded Credentials from Source Code

**User Story:** As a developer, I want credentials managed through environment variables, so that secrets are not committed to version control.

#### Acceptance Criteria

1. THE MoonPop_App SHALL load the Supabase URL and Anon_Key from environment variables injected at build time, not from hardcoded strings in source code
2. THE MoonPop_App SHALL include a `.env.example` file documenting required environment variables without containing actual secret values
3. THE MoonPop_App SHALL add `.env` and `.env.local` to `.gitignore` to prevent accidental credential commits
4. WHEN the existing Supabase anon key is rotated, THE Supabase_Backend SHALL continue to function with the new key after updating the environment variable

### Requirement 14: Decompose Monolithic index.html into Modular Project Structure

**User Story:** As a developer, I want the codebase split into separate files organized by concern, so that the project is navigable, maintainable, and supports team collaboration.

#### Acceptance Criteria

1. THE Build_System SHALL produce a single-page application from modular source files that is functionally equivalent to the current `index.html`
2. THE MoonPop_App SHALL separate HTML templates, CSS stylesheets, and JavaScript logic into distinct files
3. THE MoonPop_App SHALL organize JavaScript into modules by domain: authentication, messaging, contacts, shared sky, moon circles, moon calculations, UI/rendering, and utilities
4. THE MoonPop_App SHALL organize CSS into separate files by component or feature area
5. WHEN the Build_System compiles the source, THE Build_System SHALL produce optimized, bundled output suitable for production deployment on Vercel

### Requirement 15: Introduce a Build System and Development Toolchain

**User Story:** As a developer, I want a modern build pipeline, so that I can use modules, environment variables, and optimized production builds.

#### Acceptance Criteria

1. THE Build_System SHALL support ES module imports and exports across all JavaScript source files
2. THE Build_System SHALL inject environment variables (Supabase URL, Anon Key) at build time
3. THE Build_System SHALL produce minified and tree-shaken output for production builds
4. THE Build_System SHALL provide a development server with hot module replacement for local development
5. THE Build_System SHALL generate a production build compatible with Vercel static deployment (output to a `dist/` or `build/` directory)
6. THE MoonPop_App SHALL include a `package.json` with `build` and `dev` scripts

### Requirement 16: Update Service Worker for Modular Build Output

**User Story:** As a MoonPop user, I want the PWA to continue working offline and receiving push notifications after the architecture overhaul, so that the app experience is preserved.

#### Acceptance Criteria

1. THE Service_Worker SHALL cache the build output assets (hashed JS/CSS bundles) using a cache-first strategy
2. THE Service_Worker SHALL use a network-first strategy for the app shell (index.html) with cache fallback
3. THE Service_Worker SHALL continue to handle push notifications and notification click events
4. THE Service_Worker SHALL continue to handle `/chat/:id` deep-link routing by serving the app shell
5. WHEN a new build is deployed, THE Service_Worker SHALL detect updated assets and activate the new cache

### Requirement 17: Update Vercel Deployment Configuration

**User Story:** As a developer, I want the Vercel deployment to work with the new build output, so that the app deploys correctly from the new project structure.

#### Acceptance Criteria

1. THE MoonPop_App SHALL update `vercel.json` to serve the build output directory as the root
2. THE MoonPop_App SHALL preserve the `/chat/:id` rewrite rule pointing to the built `index.html`
3. THE MoonPop_App SHALL configure Vercel environment variables for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (or equivalent for the chosen build tool)
4. WHEN a push to the main branch occurs, THE MoonPop_App SHALL produce a working production build via Vercel's build step

### Requirement 18: Preserve All Existing Functionality

**User Story:** As a MoonPop user, I want all existing features to work identically after the overhaul, so that the refactor does not break my experience.

#### Acceptance Criteria

1. THE MoonPop_App SHALL preserve email OTP authentication flow (sign in, OTP verification, session management)
2. THE MoonPop_App SHALL preserve message compose, send, in-transit tracking, and moon-gated release
3. THE MoonPop_App SHALL preserve conversation threading, reply chains, and lunar note composition
4. THE MoonPop_App SHALL preserve the Shared Sky public posting and reaction system
5. THE MoonPop_App SHALL preserve contact management (add, search, link profiles)
6. THE MoonPop_App SHALL preserve Moon Circle creation, membership, nights, and contributions
7. THE MoonPop_App SHALL preserve user settings (profile editing, avatar upload, location selection, notification preferences)
8. THE MoonPop_App SHALL preserve moon phase display, moon altitude tracking, and SunCalc-based calculations
9. THE MoonPop_App SHALL preserve the PWA manifest, installability, and offline behavior
