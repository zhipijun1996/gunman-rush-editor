package org.gunmanrush.editor
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
class ModelCatalogTest {
    @Test fun standardDirectoryRetainsModelId() {
        val out = ModelCatalog.parse(JSONObject("""{"data":[{"id":"available-model"}]}"""))
        assertEquals("available-model", out.getJSONObject(0).getString("slug"))
    }
    @Test fun planDirectoryHidesPrivateModelsAndDeduplicates() {
        val out = ModelCatalog.parse(JSONObject("""{"models":[{"slug":"shown","visibility":"list"},{"slug":"hidden","visibility":"hidden"},{"slug":"shown","visibility":"list"}]}"""))
        assertEquals(1,out.length())
    }
    @Test fun emptyDirectoryIsActionableFailure() {
        try { ModelCatalog.parse(JSONObject("""{"data":[]}""")); fail("Expected error") }
        catch (error: IllegalStateException) { assertTrue(error.message!!.contains("没有返回可用模型")) }
    }
}
