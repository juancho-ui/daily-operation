# Apollo Authentication

## Apollo API (Apollo users)

For Apollo users: Create an API key to access the Apollo API. Pass the key in the `x-api-key` header of every request.

```bash
curl --request GET \
  --url 'https://api.apollo.io/api/v1/auth/health' \
  --header 'Content-Type: application/json' \
  --header 'Cache-Control: no-cache' \
  --header 'x-api-key: YOUR_API_KEY'
```

## OAuth 2.0 (Partners)

For Apollo partners: Implement the OAuth 2.0 authorization flow to make API requests on behalf of an Apollo user.

## Which user do your requests act as?

**API key.** A key identifies your workspace, not a person. Every API-key request acts as your workspace's longest-standing active admin — the earliest-created user who hasn't been deleted and has admin access.

**OAuth 2.0.** Tokens are issued to a specific person, so requests act as the user who granted the token.

To confirm which user your key acts as:

```bash
curl --request GET \
  --url 'https://api.apollo.io/api/v1/users/api_profile' \
  --header 'Content-Type: application/json' \
  --header 'x-api-key: YOUR_API_KEY'
```

Some endpoints accept an owner field to set ownership explicitly:
- `owner_id` on create an account
- `user_id` on update a sequence

Use get a list of users to look up IDs for your workspace.
