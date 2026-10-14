static int walCheckpoint(
  Wal *pWal,                      /* Wal connection */
  sqlite3 *db,                    /* Check for interrupts on this handle */
  int eMode,                      /* One of PASSIVE, FULL or RESTART */
  int (*xBusy)(void*),            /* Function to call when busy */
  void *pBusyArg,                 /* Context argument for xBusyHandler */
  int sync_flags,                 /* Flags for OsSync() (or 0) */
  u8 *zBuf,                       /* Temporary buffer to use */
  void *pCbData,                  /* User data passed to xCb */
  int (*xCb)(void* pCbData, int mxSafeFrame, const unsigned char* pPage, int nPage, int pageNo, int frameNo) /* Checkpoint callback */
){
  int rc = SQLITE_OK;             /* Return code */
  int szPage;                     /* Database page-size */
  struct WalIteratorRev pIter = { 0 };         /* Wal iterator context */
  u32 iDbpage = 0;                /* Next database page to write */
  u32 iFrame = 0;                 /* Wal frame containing data for iDbpage */
  u32 mxSafeFrame;                /* Max frame that can be backfilled */
  u32 mxPage;                     /* Max database page to write */
  int i;                          /* Loop counter */
  volatile WalCkptInfo *pInfo;    /* The checkpoint status information */

  szPage = walPagesize(pWal);
  testcase( szPage<=32768 );
  testcase( szPage>=65536 );
  pInfo = walCkptInfo(pWal);
  if( pInfo->nBackfill<pWal->hdr.mxFrame ){

    /* EVIDENCE-OF: R-62920-47450 The busy-handler callback is never invoked
    ** in the SQLITE_CHECKPOINT_PASSIVE mode. */
    assert( eMode!=SQLITE_CHECKPOINT_PASSIVE || xBusy==0 );

    /* Compute in mxSafeFrame the index of the last frame of the WAL that is
    ** safe to write into the database.  Frames beyond mxSafeFrame might
    ** overwrite database pages that are in use by active readers and thus
    ** cannot be backfilled from the WAL.
    */
    mxSafeFrame = pWal->hdr.mxFrame;
    mxPage = pWal->hdr.nPage;
    for(i=1; i<WAL_NREADER; i++){
      u32 y = AtomicLoad(pInfo->aReadMark+i); SEH_INJECT_FAULT;
      if( mxSafeFrame>y ){
        assert( y<=pWal->hdr.mxFrame );
        rc = walBusyLock(pWal, xBusy, pBusyArg, WAL_READ_LOCK(i), 1);
        if( rc==SQLITE_OK ){
          u32 iMark = (i==1 ? mxSafeFrame : READMARK_NOT_USED);
          AtomicStore(pInfo->aReadMark+i, iMark); SEH_INJECT_FAULT;
          walUnlockExclusive(pWal, WAL_READ_LOCK(i), 1);
        }else if( rc==SQLITE_BUSY ){
          mxSafeFrame = y;
          xBusy = 0;
        }else{
          goto walcheckpoint_out;
        }
      }
    }


#ifdef LIBSQL_CHECKPOINT_ONLY_FULL
    // in case of LIBSQL_CHECKPOINT_ONLY_FULL option we want to either checkpoint whole WAL or quickly abort the checkpoint
    if( mxSafeFrame!=walIndexHdr(pWal)->mxFrame ){
        rc = SQLITE_BUSY;
        goto walcheckpoint_out;
    }
#endif

    /* Allocate the iterator */
    if( pInfo->nBackfill<mxSafeFrame ){
      rc = walIteratorRevInit(pWal, pInfo->nBackfill, &pIter, mxSafeFrame, xCb == NULL);
      assert(rc == SQLITE_OK || pIter.frames == NULL);
    }

    if(( pIter.frames != NULL && (rc = walBusyLock(pWal,xBusy,pBusyArg,WAL_READ_LOCK(0),1))==SQLITE_OK)){
      u32 nBackfill = pInfo->nBackfill;
      pInfo->nBackfillAttempted = mxSafeFrame; SEH_INJECT_FAULT;

      /* Sync the WAL to disk */
      rc = sqlite3OsSync(pWal->pWalFd, CKPT_SYNC_FLAGS(sync_flags));

      /* If the database may grow as a result of this checkpoint, hint
      ** about the eventual size of the db file to the VFS layer.
      */
      if( rc==SQLITE_OK ){
        i64 nReq = ((i64)mxPage * szPage);
        i64 nSize;                    /* Current size of database file */
        sqlite3OsFileControl(pWal->pDbFd, SQLITE_FCNTL_CKPT_START, 0);
        rc = sqlite3OsFileSize(pWal->pDbFd, &nSize);
        if( rc==SQLITE_OK && nSize<nReq ){
          if( (nSize+65536+(i64)pWal->hdr.mxFrame*szPage)<nReq ){
            /* If the size of the final database is larger than the current
            ** database plus the amount of data in the wal file, plus the
            ** maximum size of the pending-byte page (65536 bytes), then
            ** must be corruption somewhere.  */
            rc = SQLITE_CORRUPT_BKPT;
          }else{
            sqlite3OsFileControlHint(pWal->pDbFd, SQLITE_FCNTL_SIZE_HINT,&nReq);
          }
        }

      }

      /* Iterate through the contents of the WAL, copying data to the db file */
      while( rc==SQLITE_OK && 0==walIteratorRevNext(&pIter, &iDbpage, &iFrame) ){
        i64 iOffset;
        assert( walFramePgno(pWal, iFrame)==iDbpage );
        SEH_INJECT_FAULT;
        if( AtomicLoad(&db->u1.isInterrupted) ){
          rc = db->mallocFailed ? SQLITE_NOMEM_BKPT : SQLITE_INTERRUPT;
          break;
        }
        if( iFrame<=nBackfill || iFrame>mxSafeFrame || iDbpage>mxPage ){
          continue;
        }
        iOffset = walFrameOffset(iFrame, szPage) + WAL_FRAME_HDRSIZE;
        /* testcase( IS_BIG_INT(iOffset) ); // requires a 4GiB WAL file */
        rc = sqlite3OsRead(pWal->pWalFd, zBuf, szPage, iOffset);
        if( rc!=SQLITE_OK ) break;
        iOffset = (iDbpage-1)*(i64)szPage;
        testcase( IS_BIG_INT(iOffset) );
        rc = sqlite3OsWrite(pWal->pDbFd, zBuf, szPage, iOffset);
        if( rc!=SQLITE_OK ) break;
        if (xCb) {
            rc = (xCb)(pCbData, mxSafeFrame, zBuf, szPage, iDbpage, iFrame);
        }
        if( rc!=SQLITE_OK ) break;
      }
      sqlite3OsFileControl(pWal->pDbFd, SQLITE_FCNTL_CKPT_DONE, 0);

      /* If work was actually accomplished... */
      if( rc==SQLITE_OK ){
        if( mxSafeFrame==walIndexHdr(pWal)->mxFrame ){
          if (xCb) {
              rc = (xCb)(pCbData, mxSafeFrame, NULL, 0, 0, 0);
          }
          if( rc==SQLITE_OK ){
            i64 szDb = pWal->hdr.nPage*(i64)szPage;
            testcase( IS_BIG_INT(szDb) );
            rc = sqlite3OsTruncate(pWal->pDbFd, szDb);
          }
          if( rc==SQLITE_OK ){
            rc = sqlite3OsSync(pWal->pDbFd, CKPT_SYNC_FLAGS(sync_flags));
          }
        }
        if( rc==SQLITE_OK ){
          AtomicStore(&pInfo->nBackfill, mxSafeFrame); SEH_INJECT_FAULT;
        }
      }

      /* Release the reader lock held while backfilling */
      walUnlockExclusive(pWal, WAL_READ_LOCK(0), 1);
    }

    if( rc==SQLITE_BUSY ){
      /* Reset the return code so as not to report a checkpoint failure
      ** just because there are active readers.  */
      rc = SQLITE_OK;
    }
  }

  /* If this is an SQLITE_CHECKPOINT_RESTART or TRUNCATE operation, and the
  ** entire wal file has been copied into the database file, then block
  ** until all readers have finished using the wal file. This ensures that
  ** the next process to write to the database restarts the wal file.
  */
  if( rc==SQLITE_OK && eMode!=SQLITE_CHECKPOINT_PASSIVE ){
    assert( pWal->writeLock );
    SEH_INJECT_FAULT;
    if( pInfo->nBackfill<pWal->hdr.mxFrame ){
      rc = SQLITE_BUSY;
    }else if( eMode>=SQLITE_CHECKPOINT_RESTART ){
      u32 salt1;
      sqlite3_randomness(4, &salt1);
      assert( pInfo->nBackfill==pWal->hdr.mxFrame );
      rc = walBusyLock(pWal, xBusy, pBusyArg, WAL_READ_LOCK(1), WAL_NREADER-1);
      if( rc==SQLITE_OK ){
        if( eMode==SQLITE_CHECKPOINT_TRUNCATE ){
          /* IMPLEMENTATION-OF: R-44699-57140 This mode works the same way as
          ** SQLITE_CHECKPOINT_RESTART with the addition that it also
          ** truncates the log file to zero bytes just prior to a
          ** successful return.
          **
          ** In theory, it might be safe to do this without updating the
          ** wal-index header in shared memory, as all subsequent reader or
          ** writer clients should see that the entire log file has been
          ** checkpointed and behave accordingly. This seems unsafe though,
          ** as it would leave the system in a state where the contents of
          ** the wal-index header do not match the contents of the
          ** file-system. To avoid this, update the wal-index header to
          ** indicate that the log file contains zero valid frames.  */
          walRestartHdr(pWal, salt1);
          rc = sqlite3OsTruncate(pWal->pWalFd, 0);
        }
        walUnlockExclusive(pWal, WAL_READ_LOCK(1), WAL_NREADER-1);
      }
    }
  }

 walcheckpoint_out:
  SEH_FREE_ON_ERROR(pIter, 0);
  walIteratorRevFree(&pIter);
  return rc;
}
