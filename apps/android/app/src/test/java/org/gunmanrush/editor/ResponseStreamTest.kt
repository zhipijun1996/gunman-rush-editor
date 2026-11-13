package org.gunmanrush.editor

import org.junit.Assert.*
import org.junit.Test
import java.io.StringReader

class ResponseStreamTest {
    @Test fun completedFunctionCallPreserved() {
        val result = ResponseStream.read(StringReader("data: {\"type\":\"response.output_text.delta\",\"delta\":\"处理中\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[{\"type\":\"function_call\",\"call_id\":\"c1\",\"name\":\"submit_candidate\"}]}}\n\ndata: [DONE]\n\n"))
        assertEquals("completed", result.getString("status"))
        assertEquals("c1", result.getJSONArray("output").getJSONObject(0).getString("call_id"))
    }
    @Test fun quotaFailureAfterPartialOutputIsRejected() {
        val error = runCatching { ResponseStream.read(StringReader("data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\ndata: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}}\n\n")) }.exceptionOrNull()
        assertTrue(error!!.message!!.contains("usage_limit_exceeded"))
    }
    @Test fun disconnectedStreamNeverClaimsSuccess() {
        assertTrue(runCatching { ResponseStream.read(StringReader("data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")) }.isFailure)
    }
    @Test fun multilineEventAndNoFinalNewlineSupported() {
        val result = ResponseStream.read(StringReader("data: {\"type\":\"response.completed\",\ndata: \"response\":{\"status\":\"completed\",\"output\":[]}}"))
        assertEquals("completed", result.getString("status"))
    }
    @Test fun boundedStreamFailsBeforeCandidateProcessing() {
        assertTrue(runCatching { ResponseStream.read(StringReader("data: "+"x".repeat(300)), 100) }.isFailure)
    }
}
