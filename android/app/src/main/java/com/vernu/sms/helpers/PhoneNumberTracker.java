package com.vernu.sms.helpers;

import android.content.Context;
import android.content.Intent;
import android.util.Log;
import com.vernu.sms.AppConstants;
import com.vernu.sms.TextBeeUtils;
import com.vernu.sms.workers.DeviceUpdateWorker;

/**
 * Helper class to track phone number changes and sync with backend
 */
public class PhoneNumberTracker {
    private static final String TAG = "PhoneNumberTracker";

    // SharedPreferences keys for tracking last synced phone numbers
    private static final String LAST_SYNCED_PHONE_NUMBER_1 = "LAST_SYNCED_PHONE_NUMBER_1";
    private static final String LAST_SYNCED_PHONE_NUMBER_2 = "LAST_SYNCED_PHONE_NUMBER_2";

    /**
     * Checks if phone numbers have changed since last sync
     *
     * @param context Application context
     * @param currentPhoneNumber1 Current phone number for SIM 1
     * @param currentPhoneNumber2 Current phone number for SIM 2
     * @return true if phone numbers have changed, false otherwise
     */
    public static boolean hasPhoneNumberChanged(Context context, String currentPhoneNumber1, String currentPhoneNumber2) {
        String lastSyncedPhone1 = SharedPreferenceHelper.getSharedPreferenceString(
            context,
            LAST_SYNCED_PHONE_NUMBER_1,
            ""
        );
        String lastSyncedPhone2 = SharedPreferenceHelper.getSharedPreferenceString(
            context,
            LAST_SYNCED_PHONE_NUMBER_2,
            ""
        );

        // Normalize null/empty values for comparison
        String normalizedCurrent1 = (currentPhoneNumber1 == null) ? "" : currentPhoneNumber1;
        String normalizedCurrent2 = (currentPhoneNumber2 == null) ? "" : currentPhoneNumber2;

        boolean phone1Changed = !normalizedCurrent1.equals(lastSyncedPhone1);
        boolean phone2Changed = !normalizedCurrent2.equals(lastSyncedPhone2);

        if (phone1Changed || phone2Changed) {
            Log.d(TAG, "Phone number change detected:");
            if (phone1Changed) {
                Log.d(TAG, "  Phone 1: '" + lastSyncedPhone1 + "' -> '" + normalizedCurrent1 + "'");
            }
            if (phone2Changed) {
                Log.d(TAG, "  Phone 2: '" + lastSyncedPhone2 + "' -> '" + normalizedCurrent2 + "'");
            }
            return true;
        }

        return false;
    }

    /**
     * Updates stored phone numbers after successful sync
     *
     * @param context Application context
     * @param phoneNumber1 Phone number for SIM 1
     * @param phoneNumber2 Phone number for SIM 2
     */
    public static void updateStoredPhoneNumbers(Context context, String phoneNumber1, String phoneNumber2) {
        String normalizedPhone1 = (phoneNumber1 == null) ? "" : phoneNumber1;
        String normalizedPhone2 = (phoneNumber2 == null) ? "" : phoneNumber2;

        SharedPreferenceHelper.setSharedPreferenceString(
            context,
            LAST_SYNCED_PHONE_NUMBER_1,
            normalizedPhone1
        );
        SharedPreferenceHelper.setSharedPreferenceString(
            context,
            LAST_SYNCED_PHONE_NUMBER_2,
            normalizedPhone2
        );

        Log.d(TAG, "Stored phone numbers updated: Phone1=" + normalizedPhone1 + ", Phone2=" + normalizedPhone2);
    }

    /**
     * Syncs phone numbers with backend if they have changed
     * This method should be called after detecting phone numbers in SMS operations
     *
     * @param context Application context
     */
    public static void syncPhoneNumbersWithBackend(Context context) {
        // Check if device is registered (has device ID and API key)
        String deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context,
            AppConstants.SHARED_PREFS_DEVICE_ID_KEY,
            ""
        );
        String apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            context,
            AppConstants.SHARED_PREFS_API_KEY_KEY,
            ""
        );

        if (deviceId.isEmpty() || apiKey.isEmpty()) {
            Log.d(TAG, "Device not registered yet, skipping phone number sync");
            return;
        }

        // Get current phone numbers
        String[] phoneNumbers = TextBeeUtils.getPhoneNumbers(context);
        String currentPhone1 = (phoneNumbers[0] != null && !phoneNumbers[0].isEmpty()) ? phoneNumbers[0] : "";
        String currentPhone2 = (phoneNumbers[1] != null && !phoneNumbers[1].isEmpty()) ? phoneNumbers[1] : "";

        // Check if phone numbers have changed
        if (hasPhoneNumberChanged(context, currentPhone1, currentPhone2)) {
            Log.d(TAG, "Phone numbers changed, triggering backend sync");

            // Update stored values immediately to prevent duplicate syncs
            updateStoredPhoneNumbers(context, currentPhone1, currentPhone2);

            // Send broadcast to notify MainActivity (if it's listening)
            Intent intent = new Intent("com.vernu.sms.PHONE_NUMBER_CHANGED");
            intent.putExtra("phone_number_1", currentPhone1);
            intent.putExtra("phone_number_2", currentPhone2);
            context.sendBroadcast(intent);
            Log.d(TAG, "Broadcast sent to notify MainActivity of phone number change");

            // Enqueue worker to update device on backend
            DeviceUpdateWorker.enqueueWork(context, currentPhone1, currentPhone2);
        } else {
            Log.d(TAG, "Phone numbers unchanged, skipping sync");
        }
    }
}
