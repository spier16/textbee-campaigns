package com.vernu.sms.workers;

import android.content.Context;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.work.*;
import com.vernu.sms.ApiManager;
import com.vernu.sms.dtos.RegisterDeviceInputDTO;
import com.vernu.sms.dtos.RegisterDeviceResponseDTO;
import com.vernu.sms.AppConstants;
import com.vernu.sms.helpers.SharedPreferenceHelper;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import retrofit2.Call;
import retrofit2.Response;

public class DeviceUpdateWorker extends Worker {
    private static final String TAG = "DeviceUpdateWorker";
    private static final int MAX_RETRIES = 3;

    public static final String KEY_PHONE_NUMBER = "phone_number";
    public static final String KEY_PHONE_NUMBER_2 = "phone_number_2";
    public static final String KEY_RETRY_COUNT = "retry_count";

    public DeviceUpdateWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        String phoneNumber = getInputData().getString(KEY_PHONE_NUMBER);
        String phoneNumber2 = getInputData().getString(KEY_PHONE_NUMBER_2);
        int retryCount = getInputData().getInt(KEY_RETRY_COUNT, 0);

        // Get device ID and API key from SharedPreferences
        String deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            getApplicationContext(),
            AppConstants.SHARED_PREFS_DEVICE_ID_KEY,
            ""
        );
        String apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            getApplicationContext(),
            AppConstants.SHARED_PREFS_API_KEY_KEY,
            ""
        );

        if (deviceId.isEmpty() || apiKey.isEmpty()) {
            Log.e(TAG, "Device ID or API key not found in SharedPreferences");
            return Result.failure();
        }

        if (retryCount >= MAX_RETRIES) {
            Log.e(TAG, "Maximum retry count reached for device phone number update");
            return Result.failure();
        }

        // Build the update DTO with phone numbers
        RegisterDeviceInputDTO updateInput = new RegisterDeviceInputDTO();
        if (phoneNumber != null && !phoneNumber.isEmpty()) {
            updateInput.setPhoneNumber(phoneNumber);
            Log.d(TAG, "Updating device with phone number: " + phoneNumber);
        }
        if (phoneNumber2 != null && !phoneNumber2.isEmpty()) {
            updateInput.setPhoneNumber2(phoneNumber2);
            Log.d(TAG, "Updating device with phone number 2: " + phoneNumber2);
        }

        try {
            // Call the API to update the device
            Call<RegisterDeviceResponseDTO> call = ApiManager.getApiService()
                .updateDevice(deviceId, apiKey, updateInput);
            Response<RegisterDeviceResponseDTO> response = call.execute();

            if (response.isSuccessful()) {
                Log.d(TAG, "Device phone numbers updated successfully");
                return Result.success();
            } else {
                Log.e(TAG, "Failed to update device phone numbers. Response code: " + response.code());
                return Result.retry();
            }
        } catch (IOException e) {
            Log.e(TAG, "API call failed for device phone number update: " + e.getMessage());
            return Result.retry();
        } catch (Exception e) {
            Log.e(TAG, "Unexpected error during device phone number update: " + e.getMessage());
            return Result.failure();
        }
    }

    /**
     * Enqueues work to update device phone numbers in the background
     *
     * @param context Application context
     * @param phoneNumber Primary phone number (SIM 1)
     * @param phoneNumber2 Secondary phone number (SIM 2)
     */
    public static void enqueueWork(Context context, String phoneNumber, String phoneNumber2) {
        Data inputData = new Data.Builder()
                .putString(KEY_PHONE_NUMBER, phoneNumber)
                .putString(KEY_PHONE_NUMBER_2, phoneNumber2)
                .putInt(KEY_RETRY_COUNT, 0)
                .build();

        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        OneTimeWorkRequest workRequest = new OneTimeWorkRequest.Builder(DeviceUpdateWorker.class)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
                .setInputData(inputData)
                .addTag("device_phone_update")
                .build();

        // Use REPLACE policy to avoid queuing duplicate updates
        String uniqueWorkName = "device_phone_update";
        WorkManager.getInstance(context)
                .beginUniqueWork(uniqueWorkName,
                        ExistingWorkPolicy.REPLACE,
                        workRequest)
                .enqueue();

        Log.d(TAG, "Work enqueued for device phone number update");
    }
}
