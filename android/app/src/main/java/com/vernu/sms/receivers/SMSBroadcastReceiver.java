package com.vernu.sms.receivers;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;
import android.widget.Toast;
import com.vernu.sms.AppConstants;
import com.vernu.sms.TextBeeUtils;
import com.vernu.sms.dtos.SMSDTO;
import com.vernu.sms.helpers.PhoneNumberTracker;
import com.vernu.sms.helpers.SharedPreferenceHelper;
import com.vernu.sms.workers.SMSReceivedWorker;

import java.util.Objects;
import java.util.TimeZone;


public class SMSBroadcastReceiver extends BroadcastReceiver {
    private static final String TAG = "SMSBroadcastReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, "onReceive: " + intent.getAction());
        Toast.makeText(context, "SMS Broadcast Receiver Triggered!", Toast.LENGTH_SHORT).show();

        if (!Objects.equals(intent.getAction(), Telephony.Sms.Intents.SMS_RECEIVED_ACTION)) {
            Log.d(TAG, "Not Valid intent");
            Toast.makeText(context, "Not a valid SMS intent", Toast.LENGTH_SHORT).show();
            return;
        }

        SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (messages == null) {
            Log.d(TAG, "No messages found");
            return;
        }

        String deviceId = SharedPreferenceHelper.getSharedPreferenceString(context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, "");
        String apiKey = SharedPreferenceHelper.getSharedPreferenceString(context, AppConstants.SHARED_PREFS_API_KEY_KEY, "");
        boolean receiveSMSEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(context, AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY, false);

        if (deviceId.isEmpty() || apiKey.isEmpty() || !receiveSMSEnabled) {
            Log.d(TAG, "Device ID or API Key is empty or Receive SMS Feature is disabled");
            Toast.makeText(context, "SMS Gateway not configured properly", Toast.LENGTH_SHORT).show();
            return;
        }

//        SMS receivedSMS = new SMS();
//        receivedSMS.setType("RECEIVED");
//        for (SmsMessage message : messages) {
//            receivedSMS.setMessage(receivedSMS.getMessage() + message.getMessageBody());
//            receivedSMS.setSender(message.getOriginatingAddress());
//            receivedSMS.setReceivedAt(new Date(message.getTimestampMillis()));
//        }

        SMSDTO receivedSMSDTO = new SMSDTO();

        // Use device's current time in UTC (System.currentTimeMillis() returns UTC)
        // This is more reliable than SMSC timestamps which vary by carrier
        long receivedAtMillis = System.currentTimeMillis();

        // Get device timezone offset in minutes (kept for backward compatibility)
        TimeZone tz = TimeZone.getDefault();
        int offsetMinutes = tz.getOffset(System.currentTimeMillis()) / (1000 * 60);

        // Extract subscription ID from the first message to determine which SIM received it
        int subscriptionId = -1;
        if (messages.length > 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
            try {
                // Use reflection to call getSubscriptionId() to avoid compilation errors on older API levels
                subscriptionId = (Integer) messages[0].getClass().getMethod("getSubscriptionId").invoke(messages[0]);
                Log.d(TAG, "Received SMS on subscription ID: " + subscriptionId);
            } catch (Exception e) {
                Log.w(TAG, "Could not get subscription ID from received SMS: " + e.getMessage());
            }
        }

        for (SmsMessage message : messages) {
            receivedSMSDTO.setMessage(receivedSMSDTO.getMessage() + message.getMessageBody());
            receivedSMSDTO.setSender(message.getOriginatingAddress());
            receivedSMSDTO.setReceivedAtInMillis(receivedAtMillis);
            receivedSMSDTO.setDeviceTimezoneOffsetMinutes(offsetMinutes);
        }

        // Set the phone number of the SIM that received the message
        String phoneNumber = null;
        if (subscriptionId != -1) {
            phoneNumber = TextBeeUtils.getPhoneNumberForSubscription(context, subscriptionId);
            if (phoneNumber != null && !phoneNumber.isEmpty()) {
                receivedSMSDTO.setSenderPhoneNumber(phoneNumber);
                Log.d(TAG, "Setting receiver phone number: " + phoneNumber + " for subscription ID: " + subscriptionId);
            }
        }

        // Fallback: If we couldn't get phone number from subscription ID, try default SIMs
        if (phoneNumber == null || phoneNumber.isEmpty()) {
            Log.d(TAG, "Could not determine phone number from subscription ID, trying default SIM");
            String[] phoneNumbers = TextBeeUtils.getPhoneNumbers(context);
            if (phoneNumbers[0] != null && !phoneNumbers[0].isEmpty()) {
                receivedSMSDTO.setSenderPhoneNumber(phoneNumbers[0]);
                Log.d(TAG, "Using phone number from SIM slot 0: " + phoneNumbers[0]);
            } else if (phoneNumbers[1] != null && !phoneNumbers[1].isEmpty()) {
                receivedSMSDTO.setSenderPhoneNumber(phoneNumbers[1]);
                Log.d(TAG, "Using phone number from SIM slot 1: " + phoneNumbers[1]);
            } else {
                Log.w(TAG, "Could not determine phone number for received SMS");
            }
        }
//        receivedSMSDTO.setSender(receivedSMS.getSender());
//        receivedSMSDTO.setMessage(receivedSMS.getMessage());
//        receivedSMSDTO.setReceivedAt(receivedSMS.getReceivedAt());

        // Sync phone numbers with backend if they have changed
        PhoneNumberTracker.syncPhoneNumbersWithBackend(context);

        Toast.makeText(context, "SMS received from " + receivedSMSDTO.getSender() + " - forwarding to server", Toast.LENGTH_LONG).show();
        SMSReceivedWorker.enqueueWork(context, deviceId, apiKey, receivedSMSDTO);
    }

//    private void updateLocalReceivedSMS(SMS localReceivedSMS, Context context) {
//        Executors.newSingleThreadExecutor().execute(() -> {
//            AppDatabase appDatabase = AppDatabase.getInstance(context);
//            appDatabase.localReceivedSMSDao().insertAll(localReceivedSMS);
//        });
//    }
}