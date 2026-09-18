package com.hostistock.tallyup

import android.database.sqlite.SQLiteDatabase
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import expo.modules.updates.UpdatesController
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Diagnostic module that reads expo-updates request headers from two sources:
 *   1. The current runtime UpdatesConfiguration (what the app uses to check for updates).
 *   2. The headers column stored on the most recently downloaded row in updates.db.
 *
 * This lets us verify whether LauncherSelectionPolicyFilterAware is rejecting already-downloaded
 * updates because the two header maps don't match (a mismatch would be the root cause of
 * "download completes but never applies").
 *
 * Read-only — no writes, no side effects.
 */
class OtaDiagnosticsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "OtaDiagnostics"

    @ReactMethod
    fun getOtaDiagnostics(promise: Promise) {
        Thread {
            try {
                val result = Arguments.createMap()

                // ── 1. Current runtime config requestHeaders ──────────────────────────
                val configHeadersText = try {
                    val headers = UpdatesController.instance
                        .getConstantsForModule()
                        .requestHeaders
                    if (headers.isEmpty()) {
                        "(empty map)"
                    } else {
                        headers.entries
                            .sortedBy { it.key }
                            .joinToString("\n") { (k, v) -> "$k: $v" }
                    }
                } catch (e: Exception) {
                    "error reading config: ${e.message}"
                }
                result.putString("configHeaders", configHeadersText)

                // ── 2. Stored headers from the most recently accessed update row ──────
                // Status integers: 1=READY, 3=PENDING, 5=EMBEDDED, 6=DEVELOPMENT
                // We skip EMBEDDED (5) since that's the bundled build, not a downloaded OTA.
                val dbPath = reactContext.getDatabasePath("updates.db").absolutePath
                try {
                    SQLiteDatabase.openDatabase(
                        dbPath, null, SQLiteDatabase.OPEN_READONLY
                    ).use { db ->
                        db.rawQuery(
                            """
                            SELECT headers, commit_time, status, runtime_version
                            FROM updates
                            WHERE status != 5
                            ORDER BY last_accessed DESC
                            LIMIT 1
                            """.trimIndent(),
                            null
                        ).use { cursor ->
                            if (cursor.moveToFirst()) {
                                val headersRaw =
                                    cursor.getString(cursor.getColumnIndexOrThrow("headers"))
                                val commitTimeMs =
                                    cursor.getLong(cursor.getColumnIndexOrThrow("commit_time"))
                                val statusInt =
                                    cursor.getInt(cursor.getColumnIndexOrThrow("status"))
                                val storedRuntimeVersion =
                                    cursor.getString(cursor.getColumnIndexOrThrow("runtime_version"))
                                        ?: "null"

                                // headersRaw is a JSON string stored by Room's TypeConverter,
                                // e.g. {"expo-channel-name":"production","expo-runtime-version":"1"}
                                // Pretty-print it for readability.
                                val headersText = if (headersRaw == null) {
                                    "null"
                                } else {
                                    try {
                                        val json = JSONObject(headersRaw)
                                        val keys = json.keys().asSequence().sorted().toList()
                                        if (keys.isEmpty()) "(empty object)" else
                                            keys.joinToString("\n") { k -> "$k: ${json.optString(k)}" }
                                    } catch (_: Exception) {
                                        headersRaw  // fall back to raw string if parse fails
                                    }
                                }

                                val commitTimeStr = SimpleDateFormat(
                                    "yyyy-MM-dd HH:mm:ss 'UTC'", Locale.US
                                ).apply {
                                    timeZone = java.util.TimeZone.getTimeZone("UTC")
                                }.format(Date(commitTimeMs))

                                val statusLabel = when (statusInt) {
                                    1 -> "READY"
                                    3 -> "PENDING"
                                    6 -> "DEVELOPMENT"
                                    else -> "UNKNOWN($statusInt)"
                                }

                                result.putString("storedHeaders", headersText)
                                result.putString("storedCommitTime", commitTimeStr)
                                result.putString("storedStatus", statusLabel)
                                result.putString("storedRuntimeVersion", storedRuntimeVersion)
                            } else {
                                result.putString("storedHeaders", "(no downloaded update rows found)")
                                result.putString("storedCommitTime", "—")
                                result.putString("storedStatus", "—")
                                result.putString("storedRuntimeVersion", "—")
                            }
                        }
                    }
                } catch (e: Exception) {
                    result.putString("storedHeaders", "error reading db: ${e.message}")
                    result.putString("storedCommitTime", "—")
                    result.putString("storedStatus", "—")
                    result.putString("storedRuntimeVersion", "—")
                }

                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("OTA_DIAG_ERROR", e.message ?: "unknown error", e)
            }
        }.start()
    }
}
