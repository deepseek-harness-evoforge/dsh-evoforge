# Observed failure

A runtime plugin created a bare interval and filesystem watcher during `apply`. Restart loaded a second pair, disabling the Loader entry left both pairs alive, and re-enabling added a third. The corrected design acquires both resources inside one `ctx.effect()` and returns their cleanup, so restart, disable, re-enable, and root disposal each have an exact resource count.
