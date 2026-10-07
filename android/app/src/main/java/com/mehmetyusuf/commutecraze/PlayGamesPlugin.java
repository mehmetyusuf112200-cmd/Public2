package com.mehmetyusuf.commutecraze;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.games.GamesSignInClient;
import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.PlayGamesSdk;

/** Minimal Google Play Games Services v2 bridge: sign-in + leaderboards. */
@CapacitorPlugin(name = "PlayGames")
public class PlayGamesPlugin extends Plugin {
    private boolean initialized = false;

    private boolean configured() {
        try {
            String id = getContext().getString(R.string.game_services_project_id);
            return id != null && id.matches("\\d{6,}");
        } catch (Exception e) {
            return false;
        }
    }

    private boolean ensureInit() {
        if (!configured()) return false;
        if (!initialized) {
            PlayGamesSdk.initialize(getContext());
            initialized = true;
        }
        return true;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", configured());
        call.resolve(ret);
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        if (!ensureInit()) {
            call.reject("not_configured");
            return;
        }
        final boolean interactive = call.getBoolean("interactive", true);
        GamesSignInClient client = PlayGames.getGamesSignInClient(getActivity());
        client.isAuthenticated().addOnCompleteListener(task -> {
            boolean auth = task.isSuccessful() && task.getResult() != null && task.getResult().isAuthenticated();
            if (auth || !interactive) {
                JSObject ret = new JSObject();
                ret.put("signedIn", auth);
                call.resolve(ret);
                return;
            }
            client.signIn().addOnCompleteListener(t2 -> {
                JSObject ret = new JSObject();
                ret.put("signedIn", t2.isSuccessful() && t2.getResult() != null && t2.getResult().isAuthenticated());
                call.resolve(ret);
            });
        });
    }

    @PluginMethod
    public void submitScore(PluginCall call) {
        if (!ensureInit()) {
            call.reject("not_configured");
            return;
        }
        String id = call.getString("leaderboardId");
        Long score = call.getLong("score");
        if (id == null || score == null) {
            call.reject("missing_args");
            return;
        }
        try {
            PlayGames.getLeaderboardsClient(getActivity()).submitScore(id, score);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void showLeaderboard(PluginCall call) {
        if (!ensureInit()) {
            call.reject("not_configured");
            return;
        }
        String id = call.getString("leaderboardId");
        PlayGames.getLeaderboardsClient(getActivity())
            .getLeaderboardIntent(id)
            .addOnSuccessListener(intent -> {
                getActivity().startActivityForResult(intent, 9004);
                call.resolve();
            })
            .addOnFailureListener(e -> call.reject(e.getMessage()));
    }
}
