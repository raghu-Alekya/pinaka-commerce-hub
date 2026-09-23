# Auth Service API

Base URL: `http://localhost:3009`

## Authentication

| Method | Path                                  | Purpose                                                        |
| ------ | ------------------------------------- | -------------------------------------------------------------- |
| `POST` | `/api/v1/auth/signup`                 | Create a restaurant account and its active owner               |
| `POST` | `/api/v1/auth/login`                  | Email/password login; returns short-lived access + refresh tokens |
| `POST` | `/api/v1/auth/refresh`                | Exchange a valid refresh token for a new access + refresh pair (rotation) |
| `POST` | `/api/v1/auth/logout`                 | Revoke the refresh token and related access session            |
| `GET`  | `/api/v1/auth/me`                     | Current session for a valid Bearer access token                |
| `POST` | `/api/v1/auth/google`                 | Verify a Google ID credential and sign in or create the user   |
| `POST` | `/api/v1/auth/password/reset-request` | Send password-reset email; always returns an accepted response |
| `POST` | `/api/v1/auth/password/reset`         | Set a password using the one-time reset token                  |
| `POST` | `/api/v1/auth/invitations/accept`     | Accept a dashboard user invitation and set a password          |

Passwords must contain at least eight characters. One-time invitation links expire after 24 hours and reset links expire after one hour.

Default lifetimes: access token **15 minutes** (`AUTH_ACCESS_TOKEN_SECONDS`), refresh token **7 days** (`AUTH_REFRESH_TOKEN_SECONDS`). Refresh tokens are stored as SHA-256 hashes only and are rotated on every `/auth/refresh` call.

### Refresh after login

1. `POST /api/v1/auth/login` → save `accessToken` and `refreshToken`
2. Call APIs with `Authorization: Bearer <accessToken>`
3. When access expires (401), `POST /api/v1/auth/refresh` with `{ "refreshToken": "..." }`
4. Replace both tokens with the new pair (old refresh is revoked)
5. On logout, `POST /api/v1/auth/logout` with the refresh token (and optional Authorization header)

Self sign-up creates a restaurant account with a temporary name derived from the email address and makes the signing-up user its active `OWNER`. POS onboarding creates the same account/owner relationship, but its owner remains `PENDING` until the invitation is accepted.

## Dashboard user management

The following routes require `Authorization: Bearer <accessToken>`. The authenticated user must be an active `OWNER`; results are restricted to that owner's account.

| Method   | Path                | Purpose                                                   |
| -------- | ------------------- | --------------------------------------------------------- |
| `POST`   | `/api/v1/users`     | Add a pending user and send an invitation email           |
| `GET`    | `/api/v1/users`     | List the account's users                                  |
| `GET`    | `/api/v1/users/:id` | Get one account user                                      |
| `PATCH`  | `/api/v1/users/:id` | Edit name, email, phone, role, or notification preference |
| `DELETE` | `/api/v1/users/:id` | Delete an account user                                    |

Roles are `OWNER`, `MANAGER`, and `USER`. New dashboard users have `PENDING` status until they accept their invitation.

## POS account onboarding

`POST /api/pos/account` requires the `api-key` header matching `ORDEROUT_POS_API_KEY`.

```json
{
  "account_name": "Pinaka Restaurant",
  "account_manager_email": "owner@example.com",
  "account_manager_firstname": "Pinaka",
  "account_manager_lastname": "Support",
  "account_manager_phone": "+916025165112"
}
```

This creates the account, creates its manager as a pending `OWNER`, and sends an invitation email.

## Email configuration

For local development, set `MAIL_MODE=mock`. Emails are captured in memory and can be viewed with `GET /api/v1/dev/mailbox` or cleared with `DELETE /api/v1/dev/mailbox`. No external message is sent.

For Resend, configure `RESEND_API_KEY`, `MAIL_FROM`, and optionally `MAIL_REPLY_TO`. Resend takes precedence when its API key is configured.

For SMTP, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM`. `AUTH_WEB_URL` controls the frontend base URL in reset and invitation links.

When `SMTP_HOST` is empty in development, mail is not sent externally; its recipient and action link are printed as a `Mail preview` in the auth-service terminal.
