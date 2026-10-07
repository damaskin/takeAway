package md.takeaway.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createNotificationChannels()
    }

    /**
     * The channels the API addresses pushes to (`fcm.provider.ts`): order news
     * pops up as a banner, marketing lands quietly in the shade. The manifest
     * makes "orders" the default for pushes that name no channel. Creating a
     * channel that exists is a no-op and keeps what the user set for it.
     */
    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(
                "orders",
                getString(R.string.notification_channel_orders),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply { description = getString(R.string.notification_channel_orders_description) },
        )
        manager.createNotificationChannel(
            NotificationChannel(
                "promotions",
                getString(R.string.notification_channel_promotions),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { description = getString(R.string.notification_channel_promotions_description) },
        )
    }
}
