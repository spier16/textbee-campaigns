package com.vernu.sms;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.firebase.crashlytics.FirebaseCrashlytics;
import com.vernu.sms.services.StickyNotificationService;
import com.vernu.sms.helpers.SharedPreferenceHelper;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class TextBeeUtils {
    private static final String TAG = "TextBeeUtils";
    
    public static boolean isPermissionGranted(Context context, String permission) {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED;
    }

    public static List<SubscriptionInfo> getAvailableSimSlots(Context context) {

        if (ActivityCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            return new ArrayList<>();
        }

        SubscriptionManager subscriptionManager = SubscriptionManager.from(context);
        return subscriptionManager.getActiveSubscriptionInfoList();

    }

    /**
     * Get phone number for a specific subscription ID
     * Returns the phone number from subscription info or TelephonyManager
     * Falls back to manually set phone number in shared preferences
     */
    public static String getPhoneNumberForSubscription(Context context, int subscriptionId) {
        if (ActivityCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "READ_PHONE_STATE permission not granted");
            return null;
        }

        try {
            SubscriptionManager subscriptionManager = SubscriptionManager.from(context);
            List<SubscriptionInfo> subscriptionInfoList = subscriptionManager.getActiveSubscriptionInfoList();

            if (subscriptionInfoList != null) {
                for (SubscriptionInfo info : subscriptionInfoList) {
                    if (info.getSubscriptionId() == subscriptionId) {
                        String phoneNumber = info.getNumber();
                        if (phoneNumber != null && !phoneNumber.isEmpty()) {
                            return phoneNumber;
                        }
                    }
                }
            }

            // Fallback: Try TelephonyManager
            TelephonyManager telephonyManager = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
            if (telephonyManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                TelephonyManager specificTelephonyManager = telephonyManager.createForSubscriptionId(subscriptionId);
                String phoneNumber = specificTelephonyManager.getLine1Number();
                if (phoneNumber != null && !phoneNumber.isEmpty()) {
                    return phoneNumber;
                }
            }

            Log.d(TAG, "Could not retrieve phone number for subscription " + subscriptionId);
        } catch (Exception e) {
            Log.e(TAG, "Error getting phone number for subscription " + subscriptionId, e);
        }

        return null;
    }

    /**
     * Get phone numbers for all active SIM slots
     * Returns array with up to 2 phone numbers [phoneNumber1, phoneNumber2]
     */
    public static String[] getPhoneNumbers(Context context) {
        String[] phoneNumbers = new String[2];

        List<SubscriptionInfo> subscriptionInfoList = getAvailableSimSlots(context);
        if (subscriptionInfoList != null && !subscriptionInfoList.isEmpty()) {
            for (int i = 0; i < Math.min(subscriptionInfoList.size(), 2); i++) {
                SubscriptionInfo info = subscriptionInfoList.get(i);
                int slotIndex = info.getSimSlotIndex();
                String phoneNumber = getPhoneNumberForSubscription(context, info.getSubscriptionId());

                if (slotIndex >= 0 && slotIndex < 2) {
                    phoneNumbers[slotIndex] = phoneNumber;
                }
            }
        }

        // Check for manually set phone numbers in shared preferences
        String manuallySet1 = SharedPreferenceHelper.getSharedPreferenceString(context, AppConstants.SHARED_PREFS_PHONE_NUMBER_SIM_1_KEY, null);
        String manuallySet2 = SharedPreferenceHelper.getSharedPreferenceString(context, AppConstants.SHARED_PREFS_PHONE_NUMBER_SIM_2_KEY, null);

        boolean wasManuallySet1 = SharedPreferenceHelper.getSharedPreferenceBoolean(context, AppConstants.SHARED_PREFS_PHONE_NUMBER_MANUALLY_SET_1_KEY, false);
        boolean wasManuallySet2 = SharedPreferenceHelper.getSharedPreferenceBoolean(context, AppConstants.SHARED_PREFS_PHONE_NUMBER_MANUALLY_SET_2_KEY, false);

        // Use manually set phone numbers if they exist and were explicitly set by user
        if (wasManuallySet1 && manuallySet1 != null && !manuallySet1.isEmpty()) {
            phoneNumbers[0] = manuallySet1;
        }
        if (wasManuallySet2 && manuallySet2 != null && !manuallySet2.isEmpty()) {
            phoneNumbers[1] = manuallySet2;
        }

        return phoneNumbers;
    }

    /**
     * Get phone number for a specific SIM slot index (0 or 1)
     */
    public static String getPhoneNumberForSimSlot(Context context, int simSlotIndex) {
        if (simSlotIndex < 0 || simSlotIndex > 1) {
            return null;
        }

        String[] phoneNumbers = getPhoneNumbers(context);
        return phoneNumbers[simSlotIndex];
    }

    public static void startStickyNotificationService(Context context) {
        if(!isPermissionGranted(context, Manifest.permission.RECEIVE_SMS)){
            return;
        }
        
        // Only start service if user has enabled sticky notification
        boolean stickyNotificationEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(
                context,
                AppConstants.SHARED_PREFS_STICKY_NOTIFICATION_ENABLED_KEY,
                false
        );
        
        if (stickyNotificationEnabled) {
            Intent notificationIntent = new Intent(context, StickyNotificationService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(notificationIntent);
            } else {
                context.startService(notificationIntent);
            }
            Log.i(TAG, "Starting sticky notification service");
        } else {
            Log.i(TAG, "Sticky notification disabled by user, not starting service");
        }
    }

    public static void stopStickyNotificationService(Context context) {
        Intent notificationIntent = new Intent(context, StickyNotificationService.class);
        context.stopService(notificationIntent);
        Log.i(TAG, "Stopping sticky notification service");
    }
    
    /**
     * Log a non-fatal exception to Crashlytics with additional context information
     * 
     * @param throwable The exception to log
     * @param message A message describing what happened
     * @param customData Optional map of custom key-value pairs to add as context
     */
    public static void logException(Throwable throwable, String message, Map<String, Object> customData) {
        try {
            Log.e(TAG, message, throwable);
            
            FirebaseCrashlytics crashlytics = FirebaseCrashlytics.getInstance();
            crashlytics.log(message);
            
            // Add any custom data as key-value pairs
            if (customData != null) {
                for (Map.Entry<String, Object> entry : customData.entrySet()) {
                    if (entry.getValue() instanceof String) {
                        crashlytics.setCustomKey(entry.getKey(), (String) entry.getValue());
                    } else if (entry.getValue() instanceof Boolean) {
                        crashlytics.setCustomKey(entry.getKey(), (Boolean) entry.getValue());
                    } else if (entry.getValue() instanceof Integer) {
                        crashlytics.setCustomKey(entry.getKey(), (Integer) entry.getValue());
                    } else if (entry.getValue() instanceof Long) {
                        crashlytics.setCustomKey(entry.getKey(), (Long) entry.getValue());
                    } else if (entry.getValue() instanceof Float) {
                        crashlytics.setCustomKey(entry.getKey(), (Float) entry.getValue());
                    } else if (entry.getValue() instanceof Double) {
                        crashlytics.setCustomKey(entry.getKey(), (Double) entry.getValue());
                    } else if (entry.getValue() != null) {
                        crashlytics.setCustomKey(entry.getKey(), entry.getValue().toString());
                    }
                }
            }
            
            // Record the exception
            crashlytics.recordException(throwable);
        } catch (Exception e) {
            Log.e(TAG, "Error logging exception to Crashlytics", e);
        }
    }
    
    /**
     * Simplified method to log a non-fatal exception with just a message
     */
    public static void logException(Throwable throwable, String message) {
        logException(throwable, message, null);
    }
}
