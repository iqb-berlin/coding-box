# Performance Optimizations

## Coding Statistics Retrieval Optimization

### Issue
The retrieval of coding statistics from the NestJS backend was taking a very long time, especially for workspaces with a large number of responses.

### Changes Made
The following optimizations were implemented in the `getCodingStatistics` method in `apps/backend/src/app/database/services/workspace-coding.service.ts`:

1. **Query Optimization**:
   - Combined two separate database queries (one for total count, one for status counts) into a single query
   - Calculated the total count by summing individual status counts instead of running a separate count query

2. **Caching Implementation**:
   - Added an in-memory cache with a 5-minute time-to-live (TTL)
   - Cache is keyed by workspace ID to ensure workspace-specific statistics
   - Added logging to indicate when cached results are being returned

### Expected Benefits
- **Reduced Database Load**: Fewer queries mean less load on the database
- **Faster Response Times**: Cached results are returned immediately without database queries
- **Improved Scalability**: Better handling of workspaces with large numbers of responses

### Implementation Details
- Cache is implemented as a Map with workspace ID as the key
- Each cache entry includes both the data and a timestamp for TTL calculation
- Cache invalidation happens automatically after 5 minutes
- No additional dependencies were required for this implementation

## Responses by Status Retrieval Optimization

### Issue
Retrieving responses by status from the NestJS backend was taking a very long time, especially for workspaces with a large number of responses.

### Changes Made
The following optimizations were implemented in the `getResponsesByStatus` method in `apps/backend/src/app/database/services/workspace-test-results.service.ts`:

1. **Query Optimization**:
   - Used a single query with `getManyAndCount()` to retrieve both data and count in one database call
   - Optimized the query structure to ensure efficient execution

2. **Caching Implementation**:
   - Added an in-memory cache with a 2-minute time-to-live (TTL)
   - Cache is keyed by a combination of workspace ID, status, and pagination parameters
   - Added logging to indicate when cached results are being returned

### Expected Benefits
- **Reduced Database Load**: Using a single query reduces database load
- **Faster Response Times**: Cached results are returned immediately without database queries
- **Improved User Experience**: Faster loading of responses filtered by status

### Implementation Details
- Cache is implemented as a Map with a composite key (workspace_id-status-page-limit)
- Each cache entry includes both the data and a timestamp for TTL calculation
- Cache invalidation happens automatically after 2 minutes
- No additional dependencies were required for this implementation

### Future Considerations
- If the application scales to multiple instances, consider implementing a distributed cache
- Add cache invalidation when response data is updated to ensure fresh results
- Consider adding configuration options for cache TTL

## Test Person Coding Optimization

### Issue
The `codeTestPersons` method in the NestJS backend was taking too much time when processing thousands of test persons, causing timeouts and poor user experience.

### Changes Made
The following optimizations were implemented in the `codeTestPersons` method in `apps/backend/src/app/database/services/workspace-coding.service.ts`:

1. **Multi-level Caching Implementation**:
   - Added caching for coding schemes with a 30-minute TTL
   - Added caching for test files with a 15-minute TTL
   - Reduced redundant database queries and file parsing operations

2. **Background Processing**:
   - Implemented a threshold-based approach (>100 test persons) to automatically process large batches in the background
   - Added job status tracking with progress reporting
   - Created a new API endpoint to check job status

3. **Batch Processing Improvements**:
   - Optimized database queries to select only needed fields
   - Implemented more efficient data structures for lookups
   - Added progress tracking for better user feedback

### Expected Benefits
- **Immediate Response**: Users get immediate feedback even for large batches
- **Reduced Timeouts**: Background processing prevents request timeouts
- **Better User Experience**: Progress tracking allows users to monitor long-running operations
- **Reduced Database Load**: Caching and optimized queries reduce database pressure

### Implementation Details
- Background processing is implemented using Node.js asynchronous capabilities without external dependencies
- Job status is tracked in-memory with automatic cleanup after 1 hour
- Progress reporting is implemented at key points in the processing pipeline
- The API returns a job ID that can be used to check status when processing in the background

### Future Considerations
- Consider implementing a proper job queue system with Redis for better scalability
- Add WebSocket support for real-time progress updates
- Implement more granular progress reporting

## Job Cancellation Implementation

### Issue
Long-running background jobs for coding test persons could not be cancelled, forcing users to wait for completion or restart the server.

### Changes Made
The following features were implemented to allow cancellation of background jobs:

1. **Job Status Enhancement**:
   - Added a 'cancelled' status to the job status tracking system
   - Modified the background processing to check for cancellation at multiple points
   - Implemented early termination of processing when cancellation is detected

2. **Cancellation API**:
   - Added a new `cancelJob` method to the `WorkspaceCodingService`
   - Created a new API endpoint at `/admin/workspace/:workspace_id/coding/job/:jobId/cancel`
   - Enhanced the job status API to include the 'cancelled' status in responses

3. **Graceful Termination**:
   - Implemented checks for cancellation at strategic points in the processing pipeline
   - Added proper cleanup of resources when a job is cancelled
   - Ensured consistent job status reporting for cancelled jobs

### Expected Benefits
- **Improved User Control**: Users can cancel long-running jobs that are no longer needed
- **Resource Efficiency**: System resources are freed up when jobs are cancelled
- **Better User Experience**: No need to wait for unnecessary processing to complete
- **Reduced Server Load**: Prevents accumulation of unwanted background processes

### Implementation Details
- Cancellation checks are performed at multiple stages of processing
- The job status is immediately updated when cancellation is requested
- Cancelled jobs are properly cleaned up to prevent memory leaks
- The API provides clear feedback about the success or failure of cancellation requests
