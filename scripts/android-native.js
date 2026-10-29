/* Adds Khata's notification reader to the generated Android project (run after "npx cap add android"). */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), fail = m => { console.error('android-native failed: ' + m); process.exit(1); };
const pkg = require('../capacitor.config.json').appId, base = path.join(root, 'android/app/src/main');
const dir = path.join(base, 'java', ...pkg.split('.'));
if (!fs.existsSync(dir)) fail('no Android source folder at ' + dir + ' (run "npx cap add android" first)');
const tpl = path.join(root, 'native/android');
for (const f of fs.readdirSync(tpl).filter(x => x.endsWith('.java'))) fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(tpl, f), 'utf8').split('__PACKAGE__').join(pkg));
const mp = path.join(base, 'AndroidManifest.xml'); let m = fs.readFileSync(mp, 'utf8');
if (!m.includes('KhataNotificationService')) {
  if (!m.includes('</application>')) fail('manifest has no </application>');
  m = m.replace('</application>', `    <service android:name=".KhataNotificationService" android:label="Khata auto entry" android:exported="true"
        android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">
        <intent-filter><action android:name="android.service.notification.NotificationListenerService" /></intent-filter>
    </service>
</application>`);
  fs.writeFileSync(mp, m);
}
console.log('Native notification reader added to ' + pkg);
