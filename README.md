# Pulumi AWS SSO Login

This is a proof-of-concept project that demonstrates how to log in to AWS SSO to get temporary credentials for use with Pulumi.

The intention behind this is to do away with the need for developers to synchronise their AWS CLI profiles in order to reference the same AWS account as their coworkers. Instead, we simply ask the user to get a device code from AWS SSO, and then use that to discover the correct AWS account and role to assume.

Thanks to [this fantastic blog post](https://medium.com/@lex.berger/anatomy-of-aws-sso-device-authorization-grant-2839008c367a) by Alex Berger for the explanation of how AWS SSO device authorization grants work.
