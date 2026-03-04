# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue.
2. Email **johnzellw89@gmail.com** with:
   - A description of the vulnerability
   - Steps to reproduce
   - Potential impact
3. You will receive a response within **72 hours**.
4. We will work with you to understand and address the issue before any public disclosure.

## Security Best Practices

When using argocd-mcp-lite:

- **Never commit API tokens** to version control. Use environment variables or secret management.
- **Use `MCP_READ_ONLY=true`** in production to prevent accidental mutations.
- **Avoid `NODE_TLS_REJECT_UNAUTHORIZED=0`** in production — only use for development with self-signed certs.
- **Rotate ArgoCD API tokens** regularly.
- **Use dedicated service accounts** with minimal RBAC permissions rather than admin tokens.
