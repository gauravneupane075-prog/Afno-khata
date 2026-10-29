package __PACKAGE__;

import android.content.Intent;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.Set;

/** Bridge between the web app and the notification queue. drain() does not delete anything; the app calls ack() after saving. */
@CapacitorPlugin(name = "KhataSms")
public class KhataSmsPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        boolean enabled = NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName());
        r.put("enabled", enabled);
        r.put("paused", KhataQueue.isPaused(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent i = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Cannot open notification access settings");
        }
    }

    @PluginMethod
    public void drain(PluginCall call) {
        JSObject r = new JSObject();
        r.put("events", KhataQueue.read(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void ack(PluginCall call) {
        try {
            JSArray ids = call.getArray("ids");
            Set<String> set = new HashSet<>();
            if (ids != null) for (int i = 0; i < ids.length(); i++) set.add(ids.getString(i));
            KhataQueue.remove(getContext(), set);
            call.resolve();
        } catch (Exception e) {
            call.reject("Bad ids");
        }
    }

    @PluginMethod
    public void setPaused(PluginCall call) {
        KhataQueue.setPaused(getContext(), Boolean.TRUE.equals(call.getBoolean("paused", false)));
        call.resolve();
    }
}
