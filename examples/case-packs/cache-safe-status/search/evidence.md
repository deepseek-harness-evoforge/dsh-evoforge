# Observed failure

A status extension placed changing Goal, approval, and evolution state in dynamic model context. Every status update changed the model-visible prefix even though only the host UI needed the data. The corrected design keeps an authoritative host projection and leaves system prompt, Tool Schema, Skill catalog, and model-call count unchanged.
