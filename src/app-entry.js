import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Haptics, NotificationType } from "@capacitor/haptics";

window.RutaSeguraNative = Capacitor.isNativePlatform() ? {
  isNative: true,
  async requestPermissions() {
    const location = await Geolocation.requestPermissions({ permissions: ["location"] });
    const notifications = await LocalNotifications.requestPermissions();
    return { location: location.location, notifications: notifications.display };
  },
  watchPosition(options, callback) {
    return Geolocation.watchPosition(
      { ...options, minimumUpdateInterval: 1000, interval: 1000 },
      (position, error) => callback(position, error),
    );
  },
  clearWatch(id) { return Geolocation.clearWatch({ id }); },
  notify(speed, limit) {
    return LocalNotifications.schedule({
      notifications: [{
        id: 911,
        title: "Reduce la velocidad",
        body: `Vas a ${Math.round(speed)} km/h. El límite es ${limit} km/h.`,
        schedule: { at: new Date(Date.now() + 100) },
      }],
    });
  },
  vibrate() { return Haptics.notification({ type: NotificationType.Warning }); },
} : { isNative: false };

import "./app-main.js";
