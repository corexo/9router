const fs = require('fs');
const filepath = 'src/app/(dashboard)/dashboard/providers/[id]/page.js';
let content = fs.readFileSync(filepath, 'utf8');

// Replace the handleAutoPingConnection and saveAutoPing functions
content = content.replace(
  /  const saveAutoPing = async \(next\) => \{[\s\S]*?const handleAutoPingConnection = \(connectionId, on\) => \{[\s\S]*?\};/m,
  `  const handleAutoPingConnection = (connectionId, on) => {
    const autoPingSettingsKey = AUTO_PING_SETTINGS_KEYS[providerId];
    if (!autoPingSettingsKey) return;

    setAutoPing((prev) => {
      const nextState = {
        ...prev,
        connections: {
          ...prev.connections,
          [connectionId]: on,
        },
      };

      // Fire and forget the API call to save settings
      fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [autoPingSettingsKey]: nextState }),
      }).catch((error) => {
        console.log("Error saving auto-ping config:", error);
      });

      return nextState;
    });
  };`
);

fs.writeFileSync(filepath, content);
console.log('Patched page.js successfully.');
