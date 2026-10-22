package com.mehmetyusuf.commutecraze;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlayGamesPlugin.class);
        registerPlugin(UnityAdsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
