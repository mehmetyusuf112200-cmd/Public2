package com.mehmetyusuf.commutecraze;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.unity3d.ads.IUnityAdsInitializationListener;
import com.unity3d.ads.IUnityAdsLoadListener;
import com.unity3d.ads.IUnityAdsShowListener;
import com.unity3d.ads.UnityAds;
import com.unity3d.ads.UnityAdsShowOptions;

/**
 * Minimal Unity Ads bridge.
 *   initialize({ gameId, testMode })      resolves when the SDK is ready
 *   load({ placementId })                 resolves when an ad is loaded, rejects on no fill
 *   show({ placementId })                 resolves AFTER the ad is closed: { state: completed | skipped | failed }
 */
@CapacitorPlugin(name = "UnityAdsBridge")
public class UnityAdsPlugin extends Plugin {

    @PluginMethod
    public void initialize(PluginCall call) {
        String gameId = call.getString("gameId");
        boolean testMode = call.getBoolean("testMode", false);
        if (gameId == null || gameId.isEmpty()) {
            call.reject("missing_game_id");
            return;
        }
        if (UnityAds.isInitialized()) {
            call.resolve();
            return;
        }
        UnityAds.initialize(getContext().getApplicationContext(), gameId, testMode, new IUnityAdsInitializationListener() {
            @Override
            public void onInitializationComplete() {
                call.resolve();
            }

            @Override
            public void onInitializationFailed(UnityAds.UnityAdsInitializationError error, String message) {
                call.reject("init_failed: " + message);
            }
        });
    }

    @PluginMethod
    public void load(PluginCall call) {
        String placementId = call.getString("placementId");
        if (placementId == null) {
            call.reject("missing_placement");
            return;
        }
        UnityAds.load(placementId, new IUnityAdsLoadListener() {
            @Override
            public void onUnityAdsAdLoaded(String id) {
                call.resolve();
            }

            @Override
            public void onUnityAdsFailedToLoad(String id, UnityAds.UnityAdsLoadError error, String message) {
                call.reject("load_failed: " + message);
            }
        });
    }

    @PluginMethod
    public void show(PluginCall call) {
        String placementId = call.getString("placementId");
        if (placementId == null || getActivity() == null) {
            call.reject("missing_placement");
            return;
        }
        getActivity().runOnUiThread(() ->
            UnityAds.show(getActivity(), placementId, new UnityAdsShowOptions(), new IUnityAdsShowListener() {
                @Override
                public void onUnityAdsShowFailure(String id, UnityAds.UnityAdsShowError error, String message) {
                    JSObject ret = new JSObject();
                    ret.put("state", "failed");
                    call.resolve(ret);
                }

                @Override
                public void onUnityAdsShowStart(String id) { }

                @Override
                public void onUnityAdsShowClick(String id) { }

                @Override
                public void onUnityAdsShowComplete(String id, UnityAds.UnityAdsShowCompletionState state) {
                    JSObject ret = new JSObject();
                    ret.put("state", state == UnityAds.UnityAdsShowCompletionState.COMPLETED ? "completed" : "skipped");
                    call.resolve(ret);
                }
            })
        );
    }
}
