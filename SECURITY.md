# Security notes

Please do not report or submit real passport/visa numbers, identity documents, database credentials, session secrets, or third-party API keys in issues or demos.

For a production launch, complete at least these additional steps:

- Add email ownership verification and a secure password reset/recovery flow before public account launch.
- Configure monitored backups and a database plan appropriate for retention requirements.
- Review account-deletion behavior and legal retention obligations for your deployment.
- Perform dependency auditing and a security review; keep Node, Express, PostgreSQL, and npm dependencies patched.
- Add integration tests using a disposable PostgreSQL instance and test CSRF, session expiration, rate limits, authorization isolation, and concurrent snapshot conflicts.
- Implement a privacy policy, account-data export/erasure policy, and review Indonesian PDP law and relevant jurisdictions before storing real traveler data.
- Never store uploaded identity files in the current browser localStorage snapshot; implement native encrypted document storage or a separately threat-modeled encrypted object-storage flow first.

Contact: open a private security advisory in the GitHub repository once the project has been published.
