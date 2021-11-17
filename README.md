# Purpose
This project serves as a very simple example of how to quickly get started developing functionality for PingIdentity orchestration platform

# Layout

# Ground rules
## Coding style
Coding style is enforced by actions to ensure we have consistent code so as to provide cohesive ongoing maintenance, support and quality control.
## Improvement / support
Open issues against this project or better, submit pull request with suggested modifications to improve the experience.

# Checklist
- [ ] Edit manifest.json
- [ ] Create index.json
    * Ensure function for each capability
        ```
        sdk.methods.handle_capability_<capabilityName> = async ({properties}) => {
        ```

