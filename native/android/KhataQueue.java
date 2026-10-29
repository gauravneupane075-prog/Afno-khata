package __PACKAGE__;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.Set;

/** Small on-device queue of matching notifications. Kept in no-backup storage, capped, and emptied once the app has saved the events. */
final class KhataQueue {
    private static final int MAX = 200;
    private KhataQueue() {}

    private static File queueFile(Context c) { return new File(c.getNoBackupFilesDir(), "khata-sms-queue.json"); }
    private static File pausedFile(Context c) { return new File(c.getNoBackupFilesDir(), "khata-sms-paused"); }

    static synchronized JSONArray read(Context c) {
        try {
            File f = queueFile(c);
            if (!f.exists()) return new JSONArray();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (FileInputStream in = new FileInputStream(f)) {
                byte[] buf = new byte[4096]; int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            return new JSONArray(out.toString("UTF-8"));
        } catch (Exception e) { return new JSONArray(); }
    }

    private static void write(Context c, JSONArray a) throws Exception {
        try (FileOutputStream out = new FileOutputStream(queueFile(c))) { out.write(a.toString().getBytes("UTF-8")); }
    }

    static synchronized void add(Context c, JSONObject o) {
        try {
            JSONArray cur = read(c), next = new JSONArray();
            String id = o.getString("id");
            for (int i = 0; i < cur.length(); i++) if (id.equals(cur.getJSONObject(i).optString("id"))) return;
            int start = Math.max(0, cur.length() + 1 - MAX);
            for (int i = start; i < cur.length(); i++) next.put(cur.get(i));
            next.put(o);
            write(c, next);
        } catch (Exception ignored) { }
    }

    static synchronized void remove(Context c, Set<String> ids) {
        try {
            JSONArray cur = read(c), next = new JSONArray();
            for (int i = 0; i < cur.length(); i++) if (!ids.contains(cur.getJSONObject(i).optString("id"))) next.put(cur.get(i));
            write(c, next);
        } catch (Exception ignored) { }
    }

    static boolean isPaused(Context c) { return pausedFile(c).exists(); }

    static void setPaused(Context c, boolean paused) {
        try {
            File f = pausedFile(c);
            if (paused) { if (!f.exists()) f.createNewFile(); } else if (f.exists()) f.delete();
        } catch (Exception ignored) { }
    }
}
