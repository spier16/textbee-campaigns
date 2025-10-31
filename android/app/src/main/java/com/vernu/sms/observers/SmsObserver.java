package com.vernu.sms.observers;

import android.content.Context;
import android.database.ContentObserver;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Telephony;
import android.util.Log;
import android.widget.Toast;

import com.vernu.sms.AppConstants;
import com.vernu.sms.TextBeeUtils;
import com.vernu.sms.dtos.SMSDTO;
import com.vernu.sms.helpers.PhoneNumberTracker;
import com.vernu.sms.helpers.SharedPreferenceHelper;
import com.vernu.sms.helpers.SmsDebugHelper;
import com.vernu.sms.workers.SMSReceivedWorker;

public class SmsObserver extends ContentObserver {
    private static final String TAG = "SmsObserver";
    private Context context;
    private String lastMessageId = "";

    public SmsObserver(Context context) {
        super(new Handler(Looper.getMainLooper()));
        this.context = context;
    }

    @Override
    public void onChange(boolean selfChange, Uri uri) {
        super.onChange(selfChange, uri);

        Log.d(TAG, "SMS database changed: " + uri);
        Toast.makeText(context, "SMS Observer Triggered!", Toast.LENGTH_SHORT).show();

        try {
            // Debug: Log recent messages to understand what's in the database
            SmsDebugHelper.logRecentMessages(context, 5);
            SmsDebugHelper.logMmsMessages(context, 3);

            handleNewMessage();
        } catch (Exception e) {
            Log.e(TAG, "Error handling new message", e);
        }
    }

    private void handleNewMessage() {
        // Check if feature is enabled and configured
        String deviceId = SharedPreferenceHelper.getSharedPreferenceString(context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, "");
        String apiKey = SharedPreferenceHelper.getSharedPreferenceString(context, AppConstants.SHARED_PREFS_API_KEY_KEY, "");
        boolean receiveSMSEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(context, AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY, false);

        if (deviceId.isEmpty() || apiKey.isEmpty() || !receiveSMSEnabled) {
            Log.d(TAG, "SMS Gateway not configured properly");
            return;
        }

        // Query the latest messages from all SMS
        Uri smsUri = Telephony.Sms.CONTENT_URI;
        String[] projection = {
            Telephony.Sms._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
            Telephony.Sms.TYPE,
            Telephony.Sms.PROTOCOL,
            Telephony.Sms.SUBSCRIPTION_ID  // Add subscription ID to determine which SIM received the message
        };

        Cursor cursor = context.getContentResolver().query(
            smsUri,
            projection,
            Telephony.Sms.TYPE + " = ?",
            new String[]{String.valueOf(Telephony.Sms.MESSAGE_TYPE_INBOX)},
            Telephony.Sms.DATE + " DESC LIMIT 3"
        );

        if (cursor != null && cursor.moveToFirst()) {
            try {
                do {
                    String messageId = cursor.getString(cursor.getColumnIndexOrThrow(Telephony.Sms._ID));
                    String sender = cursor.getString(cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS));
                    String body = cursor.getString(cursor.getColumnIndexOrThrow(Telephony.Sms.BODY));
                    long timestamp = cursor.getLong(cursor.getColumnIndexOrThrow(Telephony.Sms.DATE));
                    int type = cursor.getInt(cursor.getColumnIndexOrThrow(Telephony.Sms.TYPE));
                    String protocol = cursor.getString(cursor.getColumnIndexOrThrow(Telephony.Sms.PROTOCOL));

                    // Get subscription ID if available
                    int subscriptionId = -1;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                        try {
                            int subIdIndex = cursor.getColumnIndex(Telephony.Sms.SUBSCRIPTION_ID);
                            if (subIdIndex != -1) {
                                subscriptionId = cursor.getInt(subIdIndex);
                            }
                        } catch (Exception e) {
                            Log.w(TAG, "Could not get subscription ID from SMS database: " + e.getMessage());
                        }
                    }

                    Log.d(TAG, "Message found - ID: " + messageId + ", From: " + sender + ", Type: " + type + ", Protocol: " + protocol + ", SubID: " + subscriptionId + ", Body: " + (body != null ? body.substring(0, Math.min(50, body.length())) : "null"));

                    // Only process new messages that we haven't seen before
                    if (!messageId.equals(lastMessageId) && type == Telephony.Sms.MESSAGE_TYPE_INBOX) {

                        // Skip regular SMS messages (protocol null or 0) to avoid duplicates with broadcast receiver
                        // Only process RCS/advanced messages (protocol non-null and non-zero)
                        if (protocol != null && !protocol.equals("0")) {
                            lastMessageId = messageId;

                            Log.d(TAG, "Processing RCS/advanced message - ID: " + messageId + ", From: " + sender + ", Protocol: " + protocol);

                            SMSDTO receivedSMSDTO = new SMSDTO();
                            receivedSMSDTO.setMessage(body);
                            receivedSMSDTO.setSender(sender);
                            receivedSMSDTO.setReceivedAtInMillis(timestamp);

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
                                    Log.w(TAG, "Could not determine phone number for received RCS message");
                                }
                            }

                            // Sync phone numbers with backend if they have changed
                            PhoneNumberTracker.syncPhoneNumbersWithBackend(context);

                            Toast.makeText(context, "RCS message received from " + sender + " - forwarding to server", Toast.LENGTH_LONG).show();
                            SMSReceivedWorker.enqueueWork(context, deviceId, apiKey, receivedSMSDTO);
                            break; // Process only the first new message
                        } else {
                            Log.d(TAG, "Skipping regular SMS (will be handled by broadcast receiver) - ID: " + messageId + ", Protocol: " + protocol);
                        }
                    }
                } while (cursor.moveToNext());
            } finally {
                cursor.close();
            }
        }
    }
}