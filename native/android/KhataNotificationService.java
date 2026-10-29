package __PACKAGE__;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONObject;
import java.util.regex.Pattern;

/**
 * Receives notifications only after the user turns on notification access for Khata in Android settings.
 * Keeps a notification only if it looks like a money message (an amount plus a debit/credit word) and is not an OTP.
 * Nothing is logged or sent anywhere.
 */
public class KhataNotificationService extends NotificationListenerService {
    private static final Pattern AMOUNT = Pattern.compile(
        "(?i)((?<![a-z])(rs\\.?|npr\\.?|nrs\\.?|inr|usd|\u0930\u0941\\.?|\u0930\u0942\\.?|\u20b9|\\$)\\s*[0-9\u0966-\u096F][0-9,.\u0966-\u096F]*)"
        + "|([0-9\u0966-\u096F][0-9,.\u0966-\u096F]*\\s*(rs|npr|nrs|inr|\u0930\u0941|\u0930\u0942)(?![a-z]))");
    private static final Pattern WORD = Pattern.compile(
        "(?i)\\b(debited|credited|received|withdrawn|deposited|paid|sent|transferred|payment|purchase|spent|deducted|refund|refunded|reversal|reversed)\\b"
        + "|\u0921\u0947\u092c\u093f\u091f|\u0915\u094d\u0930\u0947\u0921\u093f\u091f|\u091c\u092e\u094d\u092e\u093e|\u0928\u093f\u0915\u093e\u0932|\u092a\u094d\u0930\u093e\u092a\u094d\u0924|\u092d\u0941\u0915\u094d\u0924\u093e\u0928\u0940");
    private static final Pattern OTP = Pattern.compile("(?i)\\b(otp|one[- ]time|verification code|passcode|cvv|mpin)\\b");

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null || getPackageName().equals(sbn.getPackageName())) return;
            if (KhataQueue.isPaused(this)) return;
            Notification n = sbn.getNotification();
            if (n == null || n.extras == null) return;
            if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
            Bundle e = n.extras;
            CharSequence title = e.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = e.getCharSequence(Notification.EXTRA_BIG_TEXT);
            if (text == null) text = e.getCharSequence(Notification.EXTRA_TEXT);
            if (text == null) return;
            String body = text.toString();
            if (body.length() > 1000) body = body.substring(0, 1000);
            if (OTP.matcher(body).find()) return;
            if (!AMOUNT.matcher(body).find() || !WORD.matcher(body).find()) return;
            JSONObject o = new JSONObject();
            o.put("id", sbn.getKey() + "|" + sbn.getPostTime());
            o.put("sender", title == null ? "" : title.toString());
            o.put("pkg", sbn.getPackageName());
            o.put("text", body);
            o.put("at", sbn.getPostTime());
            KhataQueue.add(this, o);
        } catch (Exception ignored) { }
    }
}
