# Observed failure

A plugin needed one default profile row but shipped only a runtime export and told users to paste YAML manually. Installing it as a plain dependency did not activate the capability, configuration drifted between profiles, and removal could not prove the original composition was restored. The corrected package declares one `dsh.bundle` patch, is selected by real `dsh plugin add`, and disappears completely after real `dsh plugin remove`.
